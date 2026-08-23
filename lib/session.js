import crypto from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";

const SECRET = process.env.SESSION_SECRET;

export function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySession(token) {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

// Single active session for employees: a valid signature alone isn't enough,
// the sessionId embedded at login must still be the CURRENT one on file for
// that employee. Logging in on a second device overwrites it, which silently
// invalidates the first device's token here on its very next request - that's
// the actual sign-out-the-other-device mechanism, there's nothing else needed
// on the "losing" device's side.
export async function verifyEmployeeSession(token) {
  const session = verifySession(token);
  if (!session || session.role !== "employee") return null;
  const { data: emp } = await supabaseAdmin.from("employees").select("current_session_id").eq("id", session.id).single();
  if (!emp || emp.current_session_id !== session.sessionId) return null;
  return session;
}
