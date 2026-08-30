import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, contact_phone, contact_email, must_change_password").eq("id", session.id).single();
  const { data: reports } = await supabaseAdmin
    .from("reports")
    .select("id, scan_name, date_required, status, client_uploaded_file_name, report_file_url, report_file_name, created_at, completed_at")
    .eq("client_id", session.id)
    .order("created_at", { ascending: false });

  // Checked fresh from the database, not read from the session token. The
  // token's must-change value is a snapshot from login time - if it said
  // true then, and the client changed their password since, the token still
  // says true until they log in again. Trusting it here would send them
  // into a loop, back to the change-password screen even after completing it.
  return NextResponse.json({ client, reports: reports || [], mustChangePassword: !!client?.must_change_password });
}
