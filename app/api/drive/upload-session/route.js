import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { ensurePatientFolder, ensureVisitFolder, ensureVisitTypeFolder, buildStandardFileName } from "../../../../lib/folderProvisioning";
import { createResumableSession } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Step 1 of a two-step direct-to-Drive upload for patient files. The browser
// calls this to get a one-time Google session URL, then PUTs the file bytes
// straight to Google (see /api/drive/upload-complete for step 2). No file
// data passes through this server, so there's no upload size ceiling here.
//
// Every new upload - old patient or new, per client direction - lands in
// [patient]/Visit_[date]_[ScanTypes]/[Raw_DICOM|Reports|Exports]/, with the
// file renamed to the standard PatientID_Date_Type pattern. visitId is
// optional and defaults to the patient's most recent visit for convenience;
// pass it explicitly when uploading for an earlier or specific visit.
export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) {
    return NextResponse.json({ error: "Sign in as staff to upload files." }, { status: 401 });
  }
  try {
    const { patientId, filename, mimeType, sizeBytes, fileType, visitId } = await req.json();
    if (!patientId || !filename || !sizeBytes) {
      return NextResponse.json({ error: "patientId, filename, and sizeBytes are required" }, { status: 400 });
    }
    const classifiedType = ["raw_data", "report", "other"].includes(fileType) ? fileType : "other";

    let targetVisitId = visitId;
    if (!targetVisitId) {
      const { data: recentVisit } = await supabaseAdmin
        .from("visits")
        .select("id")
        .eq("patient_id", patientId)
        .order("exam_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetVisitId = recentVisit?.id || null;
    }

    const patientFolderId = await ensurePatientFolder(patientId);
    let uploadFolderId = patientFolderId;
    let standardName = filename;

    if (targetVisitId) {
      const { data: visit } = await supabaseAdmin.from("visits").select("exam_date").eq("id", targetVisitId).maybeSingle();
      const visitFolderId = await ensureVisitFolder(patientFolderId, targetVisitId);
      uploadFolderId = await ensureVisitTypeFolder(visitFolderId, targetVisitId, classifiedType);
      standardName = await buildStandardFileName(patientId, visit?.exam_date, classifiedType, filename);
    }

    const sessionUrl = await createResumableSession(
      uploadFolderId, standardName, mimeType || "application/octet-stream", sizeBytes, req.headers.get("origin")
    );
    return NextResponse.json({ sessionUrl, folderId: uploadFolderId, visitId: targetVisitId, standardName });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not start upload" }, { status: 500 });
  }
}
