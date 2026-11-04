const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Turns Orthanc's study archive (one DICOM file per slice) into the Romexis
// export layout - "<Name> ROMEXIS/<Name>.dcm" (one Enhanced CT multi-frame
// file) plus <Name>.txt and <Name>.xml - so staff no longer export from
// Romexis by hand (Mohamed Said, 4 Nov 2026). The work is done by
// romexis/romexis_bundle.py (pydicom), checked pixel-for-pixel against the
// source slices and opened in Romexis Viewer before going live.
//
// Never blocks an upload: on any failure it returns null and the caller
// uploads Orthanc's original archive exactly as before.
const SCRIPT = path.join(__dirname, "romexis", "romexis_bundle.py");
const TIMEOUT_MS = Number(process.env.ROMEXIS_CONVERT_TIMEOUT_SECONDS || 600) * 1000;

function convertArchive(archiveBuffer) {
  if (process.env.ROMEXIS_CONVERT === "off") return Promise.resolve(null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "romexis-job-"));
  const inZip = path.join(dir, "in.zip");
  const outZip = path.join(dir, "out.zip");
  fs.writeFileSync(inZip, archiveBuffer);
  return new Promise((resolve) => {
    execFile("python3", [SCRIPT, "--zip", inZip, outZip], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      try {
        if (err) {
          console.error(`[romexis] conversion failed, uploading the original archive: ${String(stderr || err.message).trim().slice(-500)}`);
          return resolve(null);
        }
        const out = fs.readFileSync(outZip);
        console.log(`[romexis] ${String(stdout).trim()} (${(out.length / 1048576).toFixed(1)} MB)`);
        resolve(out);
      } catch (e) {
        console.error(`[romexis] could not read the converted file, uploading the original archive: ${e.message}`);
        resolve(null);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

module.exports = { convertArchive };
