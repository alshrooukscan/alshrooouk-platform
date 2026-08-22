import { NextResponse } from "next/server";
import { ensurePatientFolder } from "../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req) {
  try {
    const body = await req.json();
    const { patientId, filename, mimeType, base64 } = body;
    if (!patientId || !filename || !base64) {
      return NextResponse.json({ error: "patientId, filename, and base64 are required" }, { status: 400 });
    }
    const folderId = await ensurePatientFolder(patientId);
    const buffer = Buffer.from(base64, "base64");
    const file = await uploadFile(folderId, filename, mimeType || "application/octet-stream", buffer);

    // A real file just landed in this patient's folder, mark their most recent
    // visit as having raw data uploaded, no need for staff to toggle it by hand.
    const { data: recentVisit } = await supabaseAdmin
      .from("visits")
      .select("id")
      .eq("patient_id", patientId)
      .order("exam_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentVisit) {
      await supabaseAdmin.from("visits").update({ raw_data_uploaded: true }).eq("id", recentVisit.id);
    }

    return NextResponse.json({ file, folderId });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
