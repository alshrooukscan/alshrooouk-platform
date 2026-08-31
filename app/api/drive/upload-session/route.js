import { NextResponse } from "next/server";
import { ensurePatientFolder } from "../../../../lib/folderProvisioning";
import { createResumableSession } from "../../../../lib/googleDrive";

// Step 1 of a two-step direct-to-Drive upload for patient files. The browser
// calls this to get a one-time Google session URL, then PUTs the file bytes
// straight to Google (see /api/drive/upload-complete for step 2). No file
// data passes through this server, so there's no upload size ceiling here.
export async function POST(req) {
  try {
    const { patientId, filename, mimeType, sizeBytes } = await req.json();
    if (!patientId || !filename || !sizeBytes) {
      return NextResponse.json({ error: "patientId, filename, and sizeBytes are required" }, { status: 400 });
    }
    const folderId = await ensurePatientFolder(patientId);
    const sessionUrl = await createResumableSession(
      folderId, filename, mimeType || "application/octet-stream", sizeBytes
    );
    return NextResponse.json({ sessionUrl, folderId });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not start upload" }, { status: 500 });
  }
}
