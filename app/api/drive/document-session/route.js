import { NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/requireStaff";
import { ensureEmployeeDocumentsFolder } from "../../../../lib/folderProvisioning";
import { createResumableSession } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) {
    return NextResponse.json({ error: "Sign in as staff to upload files." }, { status: 401 });
  }
  try {
    const { entityType, entityId, fileName, mimeType, sizeBytes } = await req.json();
    if (!entityType || !entityId || !fileName || !sizeBytes) {
      return NextResponse.json({ error: "entityType, entityId, fileName, and sizeBytes are required" }, { status: 400 });
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
    const sessionUrl = await createResumableSession(folderId, fileName, mimeType || "application/octet-stream", sizeBytes, req.headers.get("origin"));
    return NextResponse.json({ sessionUrl, folderId });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not start upload" }, { status: 500 });
  }
}
