import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { listFiles } from "../../../../../lib/googleDrive";

export async function GET(req) {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  // Authorization boundary: this doctor may only see files for a patient they
  // actually have a visit/referral relationship with. Never trust patientId alone.
  const { data: authorizedVisit } = await supabaseAdmin
    .from("visits")
    .select("id")
    .eq("doctor_id", session.id)
    .eq("patient_id", patientId)
    .limit(1)
    .maybeSingle();

  if (!authorizedVisit) {
    return NextResponse.json({ error: "You do not have access to this patient's files" }, { status: 403 });
  }

  const { data: folder } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "patient")
    .eq("entity_id", patientId)
    .maybeSingle();

  if (!folder) {
    return NextResponse.json({ files: [] });
  }

  const files = await listFiles(folder.drive_folder_id);
  return NextResponse.json({ files });
}
