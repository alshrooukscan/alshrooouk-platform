import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { signSession } from "../../../../lib/session";

// Tries each account type in turn so the person never has to say who they are,
// only one login exists, the system figures out the role from the credentials.
async function tryPatient(username, password) {
  const { data: id } = await supabaseAdmin.rpc("verify_patient_credentials", { p_username: username, p_password: password });
  if (!id) return null;
  const [{ data }, { data: auth }] = await Promise.all([
    supabaseAdmin.from("patients").select("name").eq("id", id).single(),
    supabaseAdmin.from("patient_auth").select("must_change_password").eq("patient_id", id).single(),
  ]);
  return { role: "patient", id, name: data?.name, mustChangePassword: auth?.must_change_password ?? false };
}
async function tryDoctor(username, password) {
  const { data: id } = await supabaseAdmin.rpc("verify_doctor_credentials", { p_username: username, p_password: password });
  if (!id) return null;
  const { data } = await supabaseAdmin.from("doctors").select("name, must_change_password").eq("id", id).single();
  return { role: "doctor", id, name: data?.name, mustChangePassword: data?.must_change_password ?? false };
}
async function tryEmployee(username, password) {
  const { data: id } = await supabaseAdmin.rpc("verify_employee_credentials", { p_username: username, p_password: password });
  if (!id) return null;
  const { data } = await supabaseAdmin.from("employees").select("name, permissions, must_change_password").eq("id", id).single();
  return { role: "employee", id, name: data?.name, permissions: data?.permissions, mustChangePassword: data?.must_change_password ?? false };
}
async function tryClient(username, password) {
  const { data: id } = await supabaseAdmin.rpc("verify_client_credentials", { p_username: username, p_password: password });
  if (!id) return null;
  const { data } = await supabaseAdmin.from("clients").select("name, must_change_password").eq("id", id).single();
  return { role: "client", id, name: data?.name, mustChangePassword: data?.must_change_password ?? false };
}

export async function POST(req) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    const match = (await tryPatient(username, password)) || (await tryDoctor(username, password)) || (await tryEmployee(username, password)) || (await tryClient(username, password));

    if (!match) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // Employees get a fresh sessionId on every login. Storing it as the only
    // "current" one means a login from a second device automatically signs the
    // first one out - the previous token still verifies its signature fine, but
    // its embedded sessionId no longer matches what's on file.
    if (match.role === "employee") {
      const sessionId = randomUUID();
      await supabaseAdmin.from("employees").update({ current_session_id: sessionId }).eq("id", match.id);
      match.sessionId = sessionId;
    }

    const token = signSession(match);
    const res = NextResponse.json({ ok: true, role: match.role, name: match.name, mustChangePassword: !!match.mustChangePassword });
    res.cookies.set("portal_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
