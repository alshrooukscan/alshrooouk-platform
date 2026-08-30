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

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, contact_phone, contact_email").eq("id", session.id).single();
  const { data: reports } = await supabaseAdmin
    .from("reports")
    .select("id, scan_name, date_required, status, client_uploaded_file_name, report_file_url, report_file_name, created_at, completed_at")
    .eq("client_id", session.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ client, reports: reports || [] });
}
