const { pushPendingWorklists } = require("./worklistPusher");
const { pollForStableStudies } = require("./studyUploader");

const WORKLIST_POLL_MS = (Number(process.env.WORKLIST_POLL_SECONDS) || 30) * 1000;
const STUDY_POLL_MS = (Number(process.env.STUDY_POLL_SECONDS) || 15) * 1000;

for (const required of ["ORTHANC_USERNAME", "ORTHANC_PASSWORD", "SHSCAN_API_URL", "GATEWAY_API_KEY"]) {
  if (!process.env[required]) {
    console.error(`Missing required env var ${required}. See docker-compose.yml / .env.example.`);
    process.exit(1);
  }
}

async function loop(name, intervalMs, fn) {
  while (true) {
    try {
      await fn();
    } catch (err) {
      console.error(`[${name}] loop error: ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

console.log("shscan gateway sync agent starting.");
console.log(`  worklist push every ${WORKLIST_POLL_MS / 1000}s`);
console.log(`  study watch every ${STUDY_POLL_MS / 1000}s`);

loop("worklist", WORKLIST_POLL_MS, pushPendingWorklists);
loop("study", STUDY_POLL_MS, pollForStableStudies);
