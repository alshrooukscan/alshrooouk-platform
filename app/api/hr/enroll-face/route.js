import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { ensureEmployeePhotosFolder } from "../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../lib/googleDrive";

async function requireStaff(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return null;
  return userData.user;
}

// Stores the reference face descriptor extracted client-side (self-hosted, in
// the admin's own browser) against the employee, and files the reference photo
// in Drive for audit purposes. The descriptor is the biometric template used
// for matching at clock in/out - the photo itself is never used for matching.
export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { employeeId, descriptor, filename, mimeType, base64 } = await req.json();
    if (!employeeId || !Array.isArray(descriptor) || descriptor.length !== 128) {
      return NextResponse.json({ error: "employeeId and a 128-value descriptor are required" }, { status: 400 });
    }

    let photoFileId = null;
    if (base64 && filename) {
      const folderId = await ensureEmployeePhotosFolder();
      const buffer = Buffer.from(base64, "base64");
      const file = await uploadFile(folderId, filename, mimeType || "image/jpeg", buffer);
      photoFileId = file.id;
    }

    const { error } = await supabaseAdmin
      .from("employees")
      .update({
        face_descriptor: descriptor,
        face_photo_drive_id: photoFileId,
        face_enrolled_at: new Date().toISOString(),
      })
      .eq("id", employeeId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
