import { requireStaff } from "../../../../lib/requireStaff";
import { NextResponse } from "next/server";
import { getFileMeta } from "../../../../lib/googleDrive";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req) {
  // Every route in this group ran with the service-role key and no
  // identity check at all, so anyone who knew the path could call it.
  // Registers an uploaded radiology report.
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  try {
    const { fileId, reportId, fileName } = await req.json();
    if (!fileId || !reportId || !fileName) {
      return NextResponse.json({ error: "fileId, reportId, and fileName are required" }, { status: 400 });
    }
    const file = await getFileMeta(fileId);
    // A report can carry several files (Reham, 21 Oct 2026). Each upload is
    // added to the list; the first file stays in report_file_url/name so the
    // screens that read those keep working.
    const { data: current } = await supabaseAdmin.from("reports").select("report_files, report_file_url, report_file_name, status, completed_at").eq("id", reportId).single();
    if (!current) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const files = Array.isArray(current.report_files) ? current.report_files : [];
    if (!files.some((f) => f.file_id === fileId)) {
      files.push({ file_id: fileId, name: fileName, url: file.webViewLink || null, uploaded_at: new Date().toISOString(), uploaded_by: staff.name || null });
    }
    const { data: updated, error } = await supabaseAdmin
      .from("reports")
      .update({
        report_files: files,
        report_file_url: current.report_file_url || file.webViewLink || null,
        report_file_name: current.report_file_name || fileName,
        status: "completed",
        completed_at: current.status === "completed" && current.completed_at ? current.completed_at : new Date().toISOString(),
      }).eq("id", reportId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ report: updated, driveFile: file });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not finalize upload" }, { status: 500 });
  }
}
