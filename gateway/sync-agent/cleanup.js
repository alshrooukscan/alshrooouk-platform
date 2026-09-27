const { listStudies, getStudyMetadata, deleteStudy, SYNCED_AT_METADATA_ID } = require("./orthancClient");

const RETENTION_MS = (Number(process.env.STUDY_RETENTION_HOURS) || 24) * 60 * 60 * 1000;

// Frees up disk space on the gateway PC by deleting studies from Orthanc's
// own local storage - the copy the CBCT machine sent, not the one already
// safely uploaded to Drive - once they're old enough. Never touches a study
// that studyUploader.js hasn't stamped "SyncedAt" (still mid-transfer, or a
// failed upload waiting on manual reprocessing), so nothing is ever deleted
// before it's confirmed to exist safely elsewhere. STUDY_RETENTION_HOURS
// (docker-compose.yml) controls how long that safety buffer is; default 24h.
async function cleanupOldStudies() {
  const studyIds = await listStudies();
  const cutoff = Date.now() - RETENTION_MS;
  let deleted = 0;

  for (const studyId of studyIds) {
    const syncedAt = await getStudyMetadata(studyId, SYNCED_AT_METADATA_ID);
    if (!syncedAt) continue; // not yet uploaded (or failed) - leave it alone

    const syncedAtMs = Date.parse(syncedAt);
    if (Number.isNaN(syncedAtMs) || syncedAtMs > cutoff) continue; // not old enough yet

    await deleteStudy(studyId);
    deleted += 1;
    console.log(`[cleanup] deleted study ${studyId} from local storage (synced ${syncedAt})`);
  }

  if (deleted > 0) {
    console.log(`[cleanup] removed ${deleted} study/studies older than ${RETENTION_MS / 3600000}h from Orthanc's local storage`);
  }
}

module.exports = { cleanupOldStudies };
