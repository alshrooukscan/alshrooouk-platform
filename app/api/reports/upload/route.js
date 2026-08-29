import { NextResponse } from "next/server";
import { ensureReportFolder } from "../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Marks a report completed by uploading the finished file into its Drive
// folder (created fresh if this is the first file for this report) and
// recording it on the row - this is what flips a report from pending to
// completed, whether it's an internal report or a real client's.
export async function POST(req) {
  try {
    const body = await req.json();
    const { reportId, fileName, mimeType, base64 } = body;
    if (!reportId || !fileName || !base64) {
      return NextResponse.json({ error: "reportId, fileName, and base64 are required" }, { status: 400 });
    }

    const { data: report } = await supabaseAdmin.from("reports").select("id").eq("id", reportId).single();
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const folderId = await ensureReportFolder(reportId);
    const buffer = Buffer.from(base64, "base64");
    const file = await uploadFile(folderId, fileName, mimeType || "application/octet-stream", buffer);

    const { data: updated, error } = await supabaseAdmin
      .from("reports")
      .update({
        report_file_url: file.webViewLink || null,
        report_file_name: fileName,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ report: updated, driveFile: file });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: 500 });
  }
}
