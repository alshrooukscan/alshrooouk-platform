import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { listFilesGrouped } from "../../../../../lib/googleDrive";

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

  // Authorization boundary: clinic-wide, matching the data route - this doctor
  // may see files for a patient referred by ANY doctor sharing their clinic_code,
  // not only their own referrals. Never trust patientId alone.
  const { data: doctor } = await supabaseAdmin.from("doctors").select("clinic_code").eq("id", session.id).single();
  let clinicDoctorIds = [session.id];
  if (doctor?.clinic_code) {
    const { data: clinicDoctors } = await supabaseAdmin.from("doctors").select("id").eq("clinic_code", doctor.clinic_code);
    if (clinicDoctors?.length) clinicDoctorIds = clinicDoctors.map((d) => d.id);
  }

  const { data: authorizedVisit } = await supabaseAdmin
    .from("visits")
    .select("id")
    .in("doctor_id", clinicDoctorIds)
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

  const files = await listFilesGrouped(folder.drive_folder_id);
  return NextResponse.json({ files });
}
