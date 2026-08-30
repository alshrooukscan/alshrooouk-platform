import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { ensureReportFolder } from "../../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../../lib/googleDrive";

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { scanName, dateRequired, fileName, mimeType, base64 } = body;
    if (!scanName || !fileName || !base64) {
      return NextResponse.json({ error: "scanName, fileName, and a file are required." }, { status: 400 });
    }

    const { data: report, error: insertErr } = await supabaseAdmin
      .from("reports")
      .insert({
        source_type: "client",
        client_id: session.id,
        scan_name: scanName,
        date_required: dateRequired || new Date().toISOString().slice(0, 10),
      })
      .select()
      .single();
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    const folderId = await ensureReportFolder(report.id);
    const buffer = Buffer.from(base64, "base64");
    const file = await uploadFile(folderId, fileName, mimeType || "application/octet-stream", buffer);

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("reports")
      .update({ client_uploaded_file_url: file.webViewLink || null, client_uploaded_file_name: fileName })
      .eq("id", report.id)
      .select()
      .single();
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, report: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Request submission failed" }, { status: 500 });
  }
}
