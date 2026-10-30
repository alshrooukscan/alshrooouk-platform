import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { signSession } from "../../../../lib/session";

// Mirror of /api/portal/employee/dashboard-link, in the other direction:
// a staff member who is also an employee (elevated via Staff Dashboard
// Access) can jump to their own employee portal without re-entering
// credentials. Issues a real portal_session cookie the exact same way a
// normal employee login does, including the single-active-session id, so
// it behaves identically to signing in directly.
export async function POST(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The link used to come from user_metadata.employee_id, which any signed-in
  // user can rewrite for themselves (security review S-03). It now comes only
  // from server-side records: an active staff profile, and the employee whose
  // staff_account_email is this account's email.
  const { data: profile } = await supabaseAdmin
    .from("staff_profiles").select("id, is_active").eq("id", userData.user.id).maybeSingle();
  if (!profile || profile.is_active === false) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = (userData.user.email || "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "This staff account isn't linked to an employee profile" }, { status: 404 });
  }
  const { data: matches } = await supabaseAdmin
    .from("employees").select("id, name").eq("staff_account_email", email).limit(2);
  const employee = matches && matches.length === 1 ? matches[0] : null;
  if (!employee) {
    return NextResponse.json({ error: "This staff account isn't linked to an employee profile" }, { status: 404 });
  }

  const sessionId = randomUUID();
  await supabaseAdmin.from("employees").update({ current_session_id: sessionId }).eq("id", employee.id);
  const portalToken = signSession({ role: "employee", id: employee.id, name: employee.name, sessionId });

  const res = NextResponse.json({ ok: true });
  res.cookies.set("portal_session", portalToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
