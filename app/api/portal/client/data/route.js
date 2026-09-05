import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";


// Records are withheld until the account is off its staff-issued temporary
// password. The redirect on the portal page is only a client-side courtesy;
// on its own it left this data reachable by calling the route directly with a
// temporary password that had travelled over WhatsApp and may be sitting in
// someone else's chat history.
//
// Returns 200 with mustChangePassword set rather than an error status, because
// the portal page reads exactly this response to decide to redirect - failing
// the request would strand the person on a broken screen instead of sending
// them to the form that fixes it.
function passwordChangeRequired() {
  return NextResponse.json({ mustChangePassword: true, gated: true });
}

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
    // Impersonating admins are exempt: they are inspecting the account, not
  // using it, and cannot set someone else's password.
  if (!session.impersonated && client?.must_change_password) return passwordChangeRequired();
  return NextResponse.json({ client, reports: reports || [], mustChangePassword: session.impersonated ? false : !!client?.must_change_password, impersonatedBy: session.impersonatedBy || null });
}
