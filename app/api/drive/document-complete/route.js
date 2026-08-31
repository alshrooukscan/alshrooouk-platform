import { NextResponse } from "next/server";
import { getFileMeta } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req) {
  try {
    const { fileId, entityType, entityId, fileName, mimeType, uploaderId, uploaderName } = await req.json();
    if (!fileId || !entityType || !entityId || !fileName) {
      return NextResponse.json({ error: "fileId, entityType, entityId, and fileName are required" }, { status: 400 });
    }
    const file = await getFileMeta(fileId);
    const { data: record, error } = await supabaseAdmin
      .from("entity_documents")
      .insert({
        entity_type: entityType, entity_id: entityId, file_name: fileName,
        drive_file_id: file.id, mime_type: mimeType || null,
        uploaded_by_id: uploaderId || null, uploaded_by_name: uploaderName || null,
      }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ document: record, driveFile: file });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not finalize upload" }, { status: 500 });
  }
}
