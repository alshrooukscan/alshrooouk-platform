import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { findOrCreateFolder, createResumableSession } from "../../../../lib/googleDrive";

const ROOT = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

// Screenshots go to one shared "Bug Reports" folder rather than anywhere near
// patient data - they are operational attachments, not clinical records, and
// must never end up inside a patient's folder.
export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in to attach a screenshot." }, { status: 401 });

  try {
    const { fileName, mimeType, sizeBytes } = await req.json();
    if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });

    const folderId = await findOrCreateFolder("Bug Reports", ROOT);
    const stamped = `${new Date().toISOString().slice(0, 10)}_${staff.name || "staff"}_${fileName}`;

    const sessionUrl = await createResumableSession(
      folderId,
      stamped,
      mimeType || "application/octet-stream",
      sizeBytes,
      req.headers.get("origin")
    );

    return NextResponse.json({ sessionUrl, fileName: stamped });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not start upload" }, { status: 500 });
  }
}
