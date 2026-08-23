import { NextResponse } from "next/server";
import { ensurePatientFolder } from "../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req) {
  try {
    const body = await req.json();
    const { patientId, filename, mimeType, base64, fileType, uploaderEmail, uploaderName } = body;
    if (!patientId || !filename || !base64) {
      return NextResponse.json({ error: "patientId, filename, and base64 are required" }, { status: 400 });
    }
    const folderId = await ensurePatientFolder(patientId);
    const buffer = Buffer.from(base64, "base64");
    const file = await uploadFile(folderId, filename, mimeType || "application/octet-stream", buffer);

    const { data: recentVisit } = await supabaseAdmin
      .from("visits")
      .select("id")
      .eq("patient_id", patientId)
      .order("exam_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const classifiedType = ["raw_data", "report", "other"].includes(fileType) ? fileType : "other";
    const now = new Date().toISOString();

    await supabaseAdmin.from("patient_files").insert({
      patient_id: patientId,
      visit_id: recentVisit?.id || null,
      drive_file_id: file.id,
      file_name: filename,
      file_type: classifiedType,
      uploaded_by_email: uploaderEmail || null,
      uploaded_by_name: uploaderName || null,
    });

    // A real file just landed, mark the relevant visit stage and stamp when it happened,
    // based on what the person said they were uploading.
    if (recentVisit) {
      if (classifiedType === "raw_data") {
        await supabaseAdmin.from("visits").update({ raw_data_uploaded: true, raw_data_uploaded_at: now }).eq("id", recentVisit.id);
      } else if (classifiedType === "report") {
        await supabaseAdmin.from("visits").update({ report_done: true, report_done_at: now }).eq("id", recentVisit.id);
      }
    }

    return NextResponse.json({ file, folderId });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
