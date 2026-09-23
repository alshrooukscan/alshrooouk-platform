import { NextResponse } from "next/server";
import { requireGateway } from "../../../../lib/requireGateway";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getFileMeta } from "../../../../lib/googleDrive";

// Step 2: called once the gateway's direct PUT to Google finished. Records
// the study exactly like a manual raw-data upload does (patient_files insert,
// scanned/raw_data_uploaded flags), or, when study-upload-session found no
// match, files it into unmatched_studies for the review queue instead.
export async function POST(req) {
  const gateway = await requireGateway(req);
  if (!gateway) return NextResponse.json({ error: "Invalid gateway key." }, { status: 401 });

  const {
    fileId, visitId, dicomStudyUid, dicomAccessionNumber,
    dicomPatientIdRaw, dicomPatientNameRaw, fileName,
  } = await req.json();

  if (!fileId || !dicomStudyUid) {
    return NextResponse.json({ error: "fileId and dicomStudyUid are required" }, { status: 400 });
  }

  const file = await getFileMeta(fileId);

  if (visitId) {
    const { data: visit } = await supabaseAdmin
      .from("visits")
      .select("id, patient_id, raw_data_uploaded, scanned")
      .eq("id", visitId)
      .maybeSingle();

    if (!visit) {
      return NextResponse.json({ error: "visitId no longer exists." }, { status: 404 });
    }

    await supabaseAdmin.from("patient_files").insert({
      patient_id: visit.patient_id,
      visit_id: visit.id,
      drive_file_id: file.id,
      file_name: fileName || file.name,
      file_type: "raw_data",
      uploaded_by_name: "DICOM Gateway",
    });

    const now = new Date().toISOString();
    const visitUpdate = { dicom_worklist_status: "matched" };
    // Same guard the manual route uses: never clobber an earlier, more
    // accurate manual timestamp or attribution.
    if (!visit.raw_data_uploaded) {
      visitUpdate.raw_data_uploaded = true;
      visitUpdate.raw_data_uploaded_at = now;
      visitUpdate.raw_data_uploaded_by_name = "DICOM Gateway";
    }
    if (!visit.scanned) {
      visitUpdate.scanned = true;
      visitUpdate.scanned_at = now;
      visitUpdate.scanned_by_name = "DICOM Gateway";
    }
    await supabaseAdmin.from("visits").update(visitUpdate).eq("id", visit.id);

    await supabaseAdmin.from("gateway_sync_log").insert({
      event_type: "study_matched",
      dicom_study_uid: dicomStudyUid,
      visit_id: visit.id,
    });

    return NextResponse.json({ matched: true, visitId: visit.id });
  }

  // No match: the file already sits in the quarantine folder (chosen in
  // study-upload-session). Record it for staff to resolve by hand - never
  // guess a patient from the raw name/ID the machine sent.
  await supabaseAdmin.from("unmatched_studies").insert({
    dicom_study_uid: dicomStudyUid,
    dicom_accession_number: dicomAccessionNumber || null,
    dicom_patient_id_raw: dicomPatientIdRaw || null,
    dicom_patient_name_raw: dicomPatientNameRaw || null,
    drive_file_id: file.id,
    file_name: fileName || file.name,
  });

  await supabaseAdmin.from("gateway_sync_log").insert({
    event_type: "study_unmatched",
    dicom_study_uid: dicomStudyUid,
    detail: `raw patient id "${dicomPatientIdRaw || ""}", raw name "${dicomPatientNameRaw || ""}"`,
  });

  return NextResponse.json({ matched: false });
}
