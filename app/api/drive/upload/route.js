import { NextResponse } from "next/server";
import { ensurePatientFolder } from "../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../lib/googleDrive";

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
    return NextResponse.json({ file, folderId });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
