import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { signSession } from "../../../../lib/session";

// Tries each account type in turn so the person never has to say who they are,
// only one login exists, the system figures out the role from the credentials.
async function tryPatient(username, password) {
  const { data: id } = await supabaseAdmin.rpc("verify_patient_credentials", { p_username: username, p_password: password });
  if (!id) return null;
  const { data } = await supabaseAdmin.from("patients").select("name").eq("id", id).single();
  return { role: "patient", id, name: data?.name };
}
async function tryDoctor(username, password) {
  const { data: id } = await supabaseAdmin.rpc("verify_doctor_credentials", { p_username: username, p_password: password });
  if (!id) return null;
  const { data } = await supabaseAdmin.from("doctors").select("name").eq("id", id).single();
  return { role: "doctor", id, name: data?.name };
}
async function tryEmployee(username, password) {
  const { data: id } = await supabaseAdmin.rpc("verify_employee_credentials", { p_username: username, p_password: password });
  if (!id) return null;
  const { data } = await supabaseAdmin.from("employees").select("name, permissions").eq("id", id).single();
  return { role: "employee", id, name: data?.name, permissions: data?.permissions };
}

export async function POST(req) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    const match = (await tryPatient(username, password)) || (await tryDoctor(username, password)) || (await tryEmployee(username, password));

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
    const res = NextResponse.json({ ok: true, role: match.role, name: match.name });
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
