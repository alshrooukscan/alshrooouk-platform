const fetch = require("node-fetch");

const ORTHANC_URL = process.env.ORTHANC_URL || "http://localhost:8042";
const AUTH = "Basic " + Buffer.from(`${process.env.ORTHANC_USERNAME}:${process.env.ORTHANC_PASSWORD}`).toString("base64");

async function orthancFetch(path, options = {}) {
  const res = await fetch(`${ORTHANC_URL}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: AUTH },
  });
  if (!res.ok) {
    throw new Error(`Orthanc ${options.method || "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res;
}

// Creates a worklist entry via the Worklists plugin's REST API (see
// https://orthanc.uclouvain.be/book/plugins/worklists-plugin-new.html). The
// XDI-350's acquisition PC picks this up on its own next worklist query
// (C-FIND) - nothing here pushes to the machine directly, DICOM worklist is
// pull-based by design.
async function createWorklist({ patientId, patientName, patientBirthDate, studyUid, accessionNumber, examDate, scanTypes }) {
  const body = {
    Tags: {
      PatientID: patientId,
      PatientName: patientName,
      ...(patientBirthDate ? { PatientBirthDate: patientBirthDate.replace(/-/g, "") } : {}),
      AccessionNumber: accessionNumber,
      StudyInstanceUID: studyUid,
      RequestedProcedureDescription: (scanTypes || []).join("+") || "CBCT",
      ScheduledProcedureStepSequence: [
        {
          Modality: "CT",
          ScheduledStationAETitle: process.env.SCHEDULED_STATION_AE_TITLE || "XLINE_ACQ",
          ScheduledProcedureStepStartDate: (examDate || new Date().toISOString().slice(0, 10)).replace(/-/g, ""),
          ScheduledProcedureStepDescription: (scanTypes || []).join("+") || "CBCT",
        },
      ],
    },
  };
  const res = await orthancFetch("/worklists/create", { method: "POST", body: JSON.stringify(body) });
  return res.json();
}

// Orthanc's Changes API - StableStudy fires once a study has stopped
// receiving new instances for StableAge seconds (orthanc.json). `since` is a
// changes sequence number, not a timestamp; passed back on every poll so
// nothing is processed twice and nothing is missed across restarts.
async function pollChanges(since) {
  const res = await orthancFetch(`/changes?since=${since}&limit=50`);
  return res.json(); // { Changes: [...], Last: n, Done: bool }
}

async function getStudy(studyId) {
  const res = await orthancFetch(`/studies/${studyId}`);
  return res.json();
}

// Raw archive bytes for one study, as a Buffer. Read once, then re-uploaded
// straight to Drive via a resumable session (see studyUploader.js) - never
// routed through Vercel.
async function getStudyArchiveBuffer(studyId) {
  const res = await orthancFetch(`/studies/${studyId}/archive`);
  return res.buffer();
}

// All studies currently held in Orthanc's local storage (internal IDs, not
// StudyInstanceUIDs) - used by cleanup.js to sweep for ones old enough to
// delete. Cheap call, just an array of IDs.
async function listStudies() {
  const res = await orthancFetch("/studies");
  return res.json();
}

// Custom per-study metadata (Orthanc's REST API supports named, not just
// numbered, metadata keys since 1.9.2). Used to stamp "SyncedAt" once a
// study has been safely uploaded to Drive, so cleanup.js knows it's safe to
// delete later and never touches a study that hasn't been confirmed synced.
async function setStudyMetadata(studyId, key, value) {
  await orthancFetch(`/studies/${studyId}/metadata/${key}`, { method: "PUT", body: value });
}

// Returns null (not an error) when the key was never set - that's the
// normal case for a study that hasn't finished uploading yet, or one that
// predates this feature.
async function getStudyMetadata(studyId, key) {
  const res = await fetch(`${ORTHANC_URL}/studies/${studyId}/metadata/${key}`, { headers: { Authorization: AUTH } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Orthanc GET /studies/${studyId}/metadata/${key} -> ${res.status}: ${await res.text()}`);
  return (await res.text()).trim();
}

async function deleteStudy(studyId) {
  await orthancFetch(`/studies/${studyId}`, { method: "DELETE" });
}

// Worklists plugin's own REST routes (distinct from /studies), valid because
// SaveInOrthancDatabase is true in orthanc.json. Used only for the resync
// path: finding and removing a stale worklist entry (the one carrying a
// patient's old name/birthdate) before pushing the corrected one, so the
// machine's worklist screen never shows two entries for the same booking.
//
// GET /worklists returns an array of objects (each carrying an "ID" field),
// not bare ID strings like most other Orthanc listing routes - confirmed
// from production logs, where treating an entry as a string produced
// "GET /worklists/[object Object] -> 404" and every resync's delete step
// silently failed, leaving the stale entry behind alongside the new one.
function worklistIdOf(item) {
  return typeof item === "string" ? item : item?.ID || item?.Id || item?.id || null;
}

async function listWorklists() {
  const res = await orthancFetch("/worklists");
  return res.json();
}

async function getWorklistTags(worklistId) {
  const res = await orthancFetch(`/worklists/${worklistId}`);
  return res.json(); // { ID, Tags: {...}, ... }
}

async function deleteWorklist(worklistId) {
  await orthancFetch(`/worklists/${worklistId}`, { method: "DELETE" });
}

// Shared by the resync path (match by AccessionNumber) and the
// visit-deletion path (match by StudyInstanceUID) - both just want "find and
// remove whichever worklist entries carry this tag value." Best-effort: a
// lookup or delete failure here is logged and swallowed rather than blocking
// whatever follows it - a leftover stale entry is a much smaller problem
// than dropping the fix/deletion that triggered this.
async function deleteWorklistsByTag(tagName, tagValue) {
  let items;
  try {
    items = await listWorklists();
  } catch (err) {
    console.error(`[worklist] could not list existing worklist entries: ${err.message}`);
    return;
  }
  for (const item of items) {
    const id = worklistIdOf(item);
    if (!id) {
      console.error(`[worklist] skipping unrecognized worklist listing entry: ${JSON.stringify(item)}`);
      continue;
    }
    try {
      // Some Orthanc versions already include Tags in the /worklists listing
      // itself - only fall back to the per-item GET when they're missing.
      const tags = item?.Tags || (await getWorklistTags(id)).Tags;
      if (tags?.[tagName] === tagValue) {
        await deleteWorklist(id);
        console.log(`[worklist] deleted worklist entry ${id} (${tagName} ${tagValue})`);
      }
    } catch (err) {
      console.error(`[worklist] could not inspect/delete worklist entry ${id}: ${err.message}`);
    }
  }
}

const deleteWorklistsByAccession = (accessionNumber) => deleteWorklistsByTag("AccessionNumber", accessionNumber);
const deleteWorklistsByStudyUid = (studyUid) => deleteWorklistsByTag("StudyInstanceUID", studyUid);

module.exports = {
  createWorklist, pollChanges, getStudy, getStudyArchiveBuffer,
  listStudies, setStudyMetadata, getStudyMetadata, deleteStudy,
  deleteWorklistsByAccession, deleteWorklistsByStudyUid,
};
