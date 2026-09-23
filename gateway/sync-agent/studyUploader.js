const fetch = require("node-fetch");
const { pollChanges, getStudy, getStudyArchiveBuffer } = require("./orthancClient");
const { startStudyUpload, completeStudyUpload } = require("./shscanClient");

const STATE_STABLE_STUDY = "StableStudy";
let lastChangeSeq = 0; // resets on agent restart; Orthanc will simply re-report any StableStudy events since 0, and completeStudyUpload is safe to call twice for the same study (see note below)

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
}

module.exports = { pollForStableStudies };
