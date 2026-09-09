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
    const { data: updated, error } = await supabaseAdmin
      .from("reports")
      .update({
        report_file_url: file.webViewLink || null, report_file_name: fileName,
        status: "completed", completed_at: new Date().toISOString(),
      }).eq("id", reportId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ report: updated, driveFile: file });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not finalize upload" }, { status: 500 });
  }
}
