import { NextResponse } from "next/server";
import { ensureEmployeeDocumentsFolder } from "../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Shared upload endpoint for both employee hiring documents and branch legal
// documents - same shape (a named file, filed under the right Drive folder,
// recorded in entity_documents), different folder resolution per entity type.
export async function POST(req) {
  try {
    const body = await req.json();
    const { entityType, entityId, fileName, mimeType, base64, uploaderId, uploaderName } = body;
    if (!entityType || !entityId || !fileName || !base64) {
      return NextResponse.json({ error: "entityType, entityId, fileName, and base64 are required" }, { status: 400 });
    }
    if (!["employee", "branch"].includes(entityType)) {
      return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
    }

    let folderId;
    if (entityType === "employee") {
      const { data: employee } = await supabaseAdmin.from("employees").select("name").eq("id", entityId).single();
      if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      folderId = await ensureEmployeeDocumentsFolder(entityId, employee.name);
    } else {
      const { data: branch } = await supabaseAdmin.from("branches").select("drive_folder_id").eq("id", entityId).single();
      if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
      if (!branch.drive_folder_id) {
        return NextResponse.json({ error: "This branch has no Drive folder configured yet - set one in Branch Management first." }, { status: 400 });
      }
      folderId = branch.drive_folder_id;
    }

    const buffer = Buffer.from(base64, "base64");
    const file = await uploadFile(folderId, fileName, mimeType || "application/octet-stream", buffer);

    const { data: record, error } = await supabaseAdmin
      .from("entity_documents")
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        file_name: fileName,
        drive_file_id: file.id,
        mime_type: mimeType || null,
        uploaded_by_id: uploaderId || null,
        uploaded_by_name: uploaderName || null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ document: record, driveFile: file });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: 500 });
  }
}
