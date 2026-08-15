import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { listFiles } from "../../../../../lib/googleDrive";

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "patient") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: patient } = await supabaseAdmin.from("patients").select("id, name, mobile, email").eq("id", session.id).single();
  const { data: visits } = await supabaseAdmin
    .from("visits")
    .select("id, scan_types, exam_date, payment_status, branches(name)")
    .eq("patient_id", session.id)
    .order("exam_date", { ascending: false });

  let files = [];
  const { data: folder } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "patient")
    .eq("entity_id", session.id)
    .maybeSingle();
  if (folder) {
    try {
      files = await listFiles(folder.drive_folder_id);
    } catch (e) {
      files = [];
    }
  }

  return NextResponse.json({ patient, visits: visits || [], files });
}
