const fs = require("fs");
const path = require("path");

// Where studyUploader.js's Orthanc /changes cursor lives, on the
// sync-agent-state volume (docker-compose.yml) so it survives a container
// restart - see the comment in studyUploader.js for why this matters.
const CURSOR_PATH = process.env.CHANGE_CURSOR_PATH || "/app/state/last-change-seq.txt";

// Missing file (first run ever, or the volume was just created) is not an
// error - it just means "start from the beginning," same as the old
// hardcoded 0 did - unless CHANGE_CURSOR_INITIAL says where to start instead.
function loadChangeSeq() {
  try {
    const raw = fs.readFileSync(CURSOR_PATH, "utf8").trim();
    const seq = Number(raw);
    return Number.isFinite(seq) && seq >= 0 ? seq : 0;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[study] could not read change cursor (starting from 0): ${err.message}`);
      return 0;
    }
    return initialChangeSeq();
  }
}

// CHANGE_CURSOR_INITIAL seeds the cursor on the one start that has no cursor
// file yet - the first start after the sync-agent-state volume is created.
// Without it that start replays Orthanc's whole /changes history from 0; set
// it to Orthanc's current "Last" (GET /changes?last) once everything before
// that has already been processed, and the replay is skipped. It is only read
// when the file is missing, so once the file exists it is ignored on every
// later restart. Saved straight away so a crash before the first poll
// finishes still resumes from it. An invalid value is logged and treated as
// unset: replaying from 0 is slow, but it never skips a study.
function initialChangeSeq() {
  const raw = (process.env.CHANGE_CURSOR_INITIAL || "").trim();
  if (!raw) return 0;
  const seq = Number(raw);
  if (!Number.isInteger(seq) || seq < 0) {
    console.error(`[study] ignoring CHANGE_CURSOR_INITIAL="${raw}" - not a non-negative whole number; starting from 0`);
    return 0;
  }
  console.log(`[study] no change cursor saved yet - starting from CHANGE_CURSOR_INITIAL=${seq}`);
  saveChangeSeq(seq);
  return seq;
}

// Best-effort: if the volume isn't writable for some reason, log it loudly
// (so it's actually noticed) rather than silently falling back to always
// replaying from 0 on every restart - the exact problem this file exists to
// fix.
function saveChangeSeq(seq) {
  try {
    fs.mkdirSync(path.dirname(CURSOR_PATH), { recursive: true });
    fs.writeFileSync(CURSOR_PATH, String(seq));
  } catch (err) {
    console.error(`[study] could not persist change cursor to ${CURSOR_PATH} - a restart will replay from 0: ${err.message}`);
  }
}

module.exports = { loadChangeSeq, saveChangeSeq };
