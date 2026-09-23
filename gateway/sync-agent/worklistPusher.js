const { createWorklist } = require("./orthancClient");
const { getWorklistQueue, confirmWorklistCreated } = require("./shscanClient");

// DICOM PN (Person Name) format is "Family^Given". shscan.com stores one
// free-text name field, usually written in Arabic, so this is a best-effort
// Latin pass only - the Arabic name stays authoritative in Supabase and is
// never sent to the machine (open item in section 7 of the development plan:
// the XDI-350's handling of Arabic character sets is unverified).
function toDicomPersonName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "UNKNOWN";
  const given = parts.slice(0, -1).join(" ");
  const family = parts[parts.length - 1];
  return `${family}^${given}`;
}

async function pushPendingWorklists() {
  const { entries } = await getWorklistQueue();
  for (const entry of entries) {
    try {
      await createWorklist({
        patientId: entry.patientId,
        patientName: toDicomPersonName(entry.patientName),
        patientBirthDate: entry.patientBirthDate,
        studyUid: entry.dicomStudyUid,
        accessionNumber: entry.dicomAccessionNumber,
        examDate: entry.examDate,
        scanTypes: entry.scanTypes,
      });
      await confirmWorklistCreated(entry.visitId, entry.dicomStudyUid);
      console.log(`[worklist] pushed visit ${entry.visitId} (study ${entry.dicomStudyUid})`);
    } catch (err) {
      // Left as dicom_worklist_status='pending' on shscan.com's side - the
      // next poll picks it up again with the same identifiers, so a failure
      // here is a retry, not a lost booking.
      console.error(`[worklist] failed to push visit ${entry.visitId}: ${err.message}`);
    }
  }
}

module.exports = { pushPendingWorklists };
