import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Feeds the unmatched-scans review queue (app/dashboard/settings/unmatched-scans/).
// Only ever unresolved rows - once staff attach a study to a visit via
// /api/gateway/unmatched/[id]/resolve, it drops off this list for good.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("unmatched_studies")
    .select("id, dicom_study_uid, dicom_accession_number, dicom_patient_id_raw, dicom_patient_name_raw, file_name, drive_file_id, received_at")
    .is("resolved_at", null)
    .order("received_at", { ascending: false });

  return NextResponse.json({ studies: data || [] });
}
