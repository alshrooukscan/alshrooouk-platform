import bcrypt from "bcryptjs";
import { supabaseAdmin } from "./supabaseAdmin";

// Shared guard for the DICOM gateway's own API routes (app/api/gateway/*).
//
// The sync agent runs on a PC that physically sits at the clinic, so it never
// holds the platform's SUPABASE_SERVICE_ROLE_KEY or GOOGLE_SERVICE_ACCOUNT_KEY -
// both stay on Vercel only. Instead it authenticates with one scoped key
// (gateway_api_keys), issued once from the dashboard and stored here only as
// a bcrypt hash, the same pattern patient_auth.password_hash already uses.
//
// Returns the matching gateway_api_keys row on success, or null. Callers
// should treat null as 401 and stop.
export async function requireGateway(req) {
  const authHeader = req.headers.get("authorization") || "";
  const key = authHeader.replace("Bearer ", "").trim();
  if (!key) return null;

  const { data: candidates } = await supabaseAdmin
    .from("gateway_api_keys")
    .select("id, label, key_hash")
    .is("revoked_at", null);

  if (!candidates || candidates.length === 0) return null;

  // Small, fixed set of gateway keys (one per clinic gateway PC, realistically
  // one total for now) - a linear bcrypt compare here costs nothing that
  // matters and avoids storing the key anywhere it could be looked up directly.
  for (const candidate of candidates) {
    if (await bcrypt.compare(key, candidate.key_hash)) return candidate;
  }
  return null;
}
