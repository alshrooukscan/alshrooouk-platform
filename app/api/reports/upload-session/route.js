import { NextResponse } from "next/server";
import { ensureReportFolder } from "../../../../lib/folderProvisioning";
import { createResumableSession } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req) {
  try {
    const { reportId, fileName, mimeType, sizeBytes } = await req.json();
    if (!reportId || !fileName || !sizeBytes) {
      return NextResponse.json({ error: "reportId, fileName, and sizeBytes are required" }, { status: 400 });
    }
    const { data: report } = await supabaseAdmin.from("reports").select("id").eq("id", reportId).single();
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const folderId = await ensureReportFolder(reportId);
    const sessionUrl = await createResumableSession(folderId, fileName, mimeType || "application/octet-stream", sizeBytes);
    return NextResponse.json({ sessionUrl, folderId });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not start upload" }, { status: 500 });
  }
}
