const fetch = require("node-fetch");
const { pollChanges, getStudy, getStudyArchiveBuffer, setStudyMetadata, SYNCED_AT_METADATA_ID } = require("./orthancClient");
const { loadChangeSeq, saveChangeSeq } = require("./changeCursor");
const { startStudyUpload, completeStudyUpload } = require("./shscanClient");

const STATE_STABLE_STUDY = "StableStudy";
// Was a plain in-memory `let lastChangeSeq = 0`, which reset to 0 on every
// container restart. Orthanc keeps its entire change history forever, so
// every redeploy replayed it from the very beginning - one clinic's gateway
// had over a year of history to grind back through (roughly one real study
// every 10-80s of Drive-upload time) before it reached that day's actual new
// scans, which sat invisible on shscan.com's side in the meantime. Now
// persisted to a file (see changeCursor.js) so a restart resumes where it
// left off instead of starting over. completeStudyUpload is still safe to
// call twice for the same study either way (see note below).
let lastChangeSeq = loadChangeSeq();

async function handleStableStudy(studyId) {
  const study = await getStudy(studyId);
  const tags = study.MainDicomTags || {};
  const patientTags = study.PatientMainDicomTags || {};

  const dicomStudyUid = tags.StudyInstanceUID;
  const dicomAccessionNumber = tags.AccessionNumber || null;
  const dicomPatientIdRaw = patientTags.PatientID || null;
  const dicomPatientNameRaw = patientTags.PatientName || null;
  const fileName = `${dicomStudyUid}.zip`;

  console.log(`[study] stable study ${studyId} (uid ${dicomStudyUid}, accession ${dicomAccessionNumber})`);

  const archive = await getStudyArchiveBuffer(studyId);

  const session = await startStudyUpload({
    dicomStudyUid,
    dicomAccessionNumber,
    dicomPatientIdRaw,
    dicomPatientNameRaw,
    fileName,
    sizeBytes: archive.length,
  });

  // Direct PUT to Google's resumable session URL, exactly like the browser
  // upload flow (lib/googleDrive.js createResumableSession) - the archive
  // never passes through a Vercel function.
  const putRes = await fetch(session.sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/zip", "Content-Length": String(archive.length) },
    body: archive,
  });
  if (!putRes.ok) {
    throw new Error(`Drive upload failed for study ${dicomStudyUid}: ${putRes.status} ${await putRes.text()}`);
  }
  const uploaded = await putRes.json(); // Google returns the created file's metadata, including its id

  const result = await completeStudyUpload({
    fileId: uploaded.id,
    visitId: session.visitId,
    dicomStudyUid,
    dicomAccessionNumber,
    dicomPatientIdRaw,
    dicomPatientNameRaw,
    fileName: session.standardName,
  });

  console.log(`[study] ${dicomStudyUid} -> ${result.matched ? `matched to visit ${result.visitId}` : "unmatched, filed for review"}`);

  // Stamps the moment this study's data safely exists in Drive (matched or
  // not - unmatched still means the file itself made it to the quarantine
  // folder for staff to resolve). cleanup.js only ever deletes a study that
  // carries this stamp, and only once it's old enough - this line is what
  // makes that safe.
  await setStudyMetadata(studyId, SYNCED_AT_METADATA_ID, new Date().toISOString());
}

async function pollForStableStudies() {
  const { Changes, Last } = await pollChanges(lastChangeSeq);
  for (const change of Changes) {
    if (change.ChangeType === STATE_STABLE_STUDY) {
      try {
        await handleStableStudy(change.ID);
      } catch (err) {
        // Not advancing lastChangeSeq past a failed change would retry it
        // forever without ever seeing later ones; instead this is logged
        // loudly for gateway_sync_log/manual follow-up, and the study can be
        // reprocessed by hand if it never shows up matched or unmatched.
        console.error(`[study] failed on change ${change.Seq} (study ${change.ID}): ${err.message}`);
      }
    }
  }
  lastChangeSeq = Last;
  saveChangeSeq(lastChangeSeq);
}

module.exports = { pollForStableStudies };
