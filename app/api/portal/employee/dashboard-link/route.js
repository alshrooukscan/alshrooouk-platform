import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { APP_URL } from "../../../../../lib/appUrl";

export async function POST() {
  const token = cookies().get("portal_session")?.value;
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: employee } = await supabaseAdmin.from("employees").select("staff_account_email, permissions").eq("id", session.id).single();
  if (!employee?.staff_account_email) {
    return NextResponse.json({ error: "No dashboard access has been granted for this account" }, { status: 403 });
  }

  const anyGranted = Object.values(employee.permissions || {}).some(Boolean);
  if (!anyGranted) {
    return NextResponse.json({ error: "No dashboard access has been granted for this account" }, { status: 403 });
  }

  // redirectTo is set explicitly rather than left to Supabase's Site URL.
  // That setting still pointed at the old vercel alias after the shscan.com
  // migration, so an employee who logged in on the new domain and opened their
  // dashboard was thrown back to the old one - on a value that lives in a
  // console, not in this repository, and could drift again unnoticed.
  // APP_URL is the single place the platform's address is defined.
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: employee.staff_account_email,
    options: { redirectTo: `${APP_URL}/dashboard` },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ link: data.properties.action_link });
}
