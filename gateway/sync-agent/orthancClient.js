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
          ScheduledStationAETitle: "XLINE_ACQ",
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

module.exports = { createWorklist, pollChanges, getStudy, getStudyArchiveBuffer };
