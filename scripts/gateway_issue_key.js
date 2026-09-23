/**
 * Al Shrooouk Platform — Issue a DICOM gateway API key
 * Run: node scripts/gateway_issue_key.js "Nasr City clinic gateway"
 * Requires env vars: NEXT_PUBLIC_SUPABASE_URL (or defaults to the production
 * project), SUPABASE_SERVICE_ROLE_KEY
 *
 * Generates one scoped key for the clinic gateway PC to authenticate with
 * app/api/gateway/*. The plaintext is shown exactly once here; only its
 * bcrypt hash is stored (gateway_api_keys.key_hash). Put the printed value
 * straight into the gateway's .env as GATEWAY_API_KEY and do not log it
 * anywhere else.
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

async function main() {
  const label = process.argv[2];
  if (!label) {
    console.error('Usage: node scripts/gateway_issue_key.js "label for this key"');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://shsotkryegamrxulsjww.supabase.co";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is required.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);
  const plaintext = `shsgw_${crypto.randomBytes(24).toString("hex")}`;
  const hash = await bcrypt.hash(plaintext, 10);

  const { error } = await supabase.from("gateway_api_keys").insert({ label, key_hash: hash });
  if (error) {
    console.error("Could not save the key:", error.message);
    process.exit(1);
  }

  console.log(`\nGateway key created for "${label}".`);
  console.log("Copy this into the gateway's .env as GATEWAY_API_KEY - it will not be shown again:\n");
  console.log(`  ${plaintext}\n`);
}

main();
