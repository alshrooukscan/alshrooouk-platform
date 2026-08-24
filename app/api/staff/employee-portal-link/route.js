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

  const employeeId = userData.user.user_metadata?.employee_id;
  if (!employeeId) {
    return NextResponse.json({ error: "This staff account isn't linked to an employee profile" }, { status: 404 });
  }

  const { data: employee } = await supabaseAdmin.from("employees").select("id, name").eq("id", employeeId).single();
  if (!employee) {
    return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
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
