import { NextResponse } from "next/server";
import { requireGateway } from "../../../../lib/requireGateway";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  ensurePatientFolder,
  ensureVisitFolder,
  ensureVisitTypeFolder,
  ensureUnmatchedQuarantineFolder,
  buildStandardFileName,
} from "../../../../lib/folderProvisioning";
import { createResumableSession } from "../../../../lib/googleDrive";

// Step 1 of the same two-step direct-to-Drive upload the browser uses
// (app/api/drive/upload-session + upload-complete), reused here so a
// multi-hundred-MB DICOM study never passes through a Vercel function body -
// the gateway PUTs the bytes straight to Google after this call.
//
// Matching happens here, before the upload even starts, because it decides
// the destination folder: a study that matches a visit by StudyInstanceUID or
// AccessionNumber goes straight into that patient's Raw_DICOM folder; one
// that matches neither goes into quarantine, and a staff member resolves it
// later (see /api/gateway/unmatched/[id]/resolve). Never matched by name -
// that is the entire reason this integration exists.
export async function POST(req) {
  const gateway = await requireGateway(req);
  if (!gateway) return NextResponse.json({ error: "Invalid gateway key." }, { status: 401 });

  const { dicomStudyUid, dicomAccessionNumber, dicomPatientIdRaw, dicomPatientNameRaw, fileName, sizeBytes } = await req.json();
  if (!dicomStudyUid || !fileName || !sizeBytes) {
    return NextResponse.json({ error: "dicomStudyUid, fileName, and sizeBytes are required" }, { status: 400 });
  }

  let visit = null;
  const byStudyUid = await supabaseAdmin.from("visits").select("id, patient_id, exam_date").eq("dicom_study_uid", dicomStudyUid).maybeSingle();
  visit = byStudyUid.data;

  if (!visit && dicomAccessionNumber) {
    const byAccession = await supabaseAdmin
      .from("visits")
      .select("id, patient_id, exam_date")
      .eq("dicom_accession_number", dicomAccessionNumber)
      .maybeSingle();
    visit = byAccession.data;
  }

  let folderId;
  let standardName;
  if (visit) {
    const patientFolderId = await ensurePatientFolder(visit.patient_id);
    const visitFolderId = await ensureVisitFolder(patientFolderId, visit.id);
    folderId = await ensureVisitTypeFolder(visitFolderId, visit.id, "raw_data");
    standardName = await buildStandardFileName(visit.patient_id, visit.exam_date, "raw_data", fileName);
  } else {
    folderId = await ensureUnmatchedQuarantineFolder();
    standardName = fileName;
  }

  const sessionUrl = await createResumableSession(folderId, standardName, "application/zip", sizeBytes, null);

  return NextResponse.json({
    sessionUrl,
    matched: Boolean(visit),
    visitId: visit?.id || null,
    folderId,
    standardName,
  });
}
