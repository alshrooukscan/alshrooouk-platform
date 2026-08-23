import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

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

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: employee.staff_account_email,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ link: data.properties.action_link });
}
