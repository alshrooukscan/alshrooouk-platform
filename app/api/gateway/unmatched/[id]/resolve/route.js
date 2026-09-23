import { NextResponse } from "next/server";
import { requireStaff } from "../../../../../../lib/requireStaff";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { ensurePatientFolder, ensureVisitFolder, ensureVisitTypeFolder, ensureUnmatchedQuarantineFolder } from "../../../../../../lib/folderProvisioning";
import { moveFile } from "../../../../../../lib/googleDrive";

// Staff attaching an unmatched study to the right patient/visit by hand, from
// the review queue (app/dashboard/settings/unmatched-scans/). The file moves
// from quarantine into the patient's real Raw_DICOM folder via Drive's own
// re-parent call (moveFile) - the ~300MB DICOM archive is never re-uploaded
// from the clinic a second time.
export async function POST(req, { params }) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = params;
  const { visitId } = await req.json();
  if (!visitId) return NextResponse.json({ error: "visitId is required" }, { status: 400 });

  const { data: unmatched } = await supabaseAdmin
    .from("unmatched_studies")
    .select("id, drive_file_id, file_name, resolved_at")
    .eq("id", id)
    .maybeSingle();

  if (!unmatched) return NextResponse.json({ error: "Unmatched study not found." }, { status: 404 });
  if (unmatched.resolved_at) return NextResponse.json({ error: "Already resolved." }, { status: 409 });
  if (!unmatched.drive_file_id) return NextResponse.json({ error: "No file recorded for this study." }, { status: 400 });

  const { data: visit } = await supabaseAdmin
    .from("visits")
    .select("id, patient_id, exam_date, raw_data_uploaded, scanned")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) return NextResponse.json({ error: "visitId does not exist." }, { status: 404 });

  const quarantineFolderId = await ensureUnmatchedQuarantineFolder();
  const patientFolderId = await ensurePatientFolder(visit.patient_id);
  const visitFolderId = await ensureVisitFolder(patientFolderId, visit.id);
  const typeFolderId = await ensureVisitTypeFolder(visitFolderId, visit.id, "raw_data");

  await moveFile(unmatched.drive_file_id, quarantineFolderId, typeFolderId);

  await supabaseAdmin.from("patient_files").insert({
    patient_id: visit.patient_id,
    visit_id: visit.id,
    drive_file_id: unmatched.drive_file_id,
    file_name: unmatched.file_name,
    file_type: "raw_data",
    uploaded_by_name: `DICOM Gateway (resolved by ${staff.name || staff.email})`,
  });

  const now = new Date().toISOString();
  const visitUpdate = { dicom_worklist_status: "matched" };
  if (!visit.raw_data_uploaded) {
    visitUpdate.raw_data_uploaded = true;
    visitUpdate.raw_data_uploaded_at = now;
    visitUpdate.raw_data_uploaded_by_name = staff.name || staff.email;
  }
  if (!visit.scanned) {
    visitUpdate.scanned = true;
    visitUpdate.scanned_at = now;
    visitUpdate.scanned_by_name = staff.name || staff.email;
  }
  await supabaseAdmin.from("visits").update(visitUpdate).eq("id", visit.id);

  await supabaseAdmin
    .from("unmatched_studies")
    .update({ resolved_visit_id: visit.id, resolved_by_name: staff.name || staff.email, resolved_at: now })
    .eq("id", id);

  await supabaseAdmin.from("gateway_sync_log").insert({
    event_type: "unmatched_resolved",
    dicom_study_uid: null,
    visit_id: visit.id,
    detail: `unmatched_studies ${id} attached by ${staff.name || staff.email}`,
  });

  return NextResponse.json({ ok: true });
}
