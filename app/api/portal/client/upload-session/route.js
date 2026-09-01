import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { ensureReportFolder } from "../../../../../lib/folderProvisioning";
import { createResumableSession } from "../../../../../lib/googleDrive";

// Client portal has no pre-existing report row to attach a file to (unlike
// staff report upload), so step 1 here creates the request row first, then
// opens the Drive session against its freshly-provisioned folder.
export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { scanName, dateRequired, fileName, mimeType, sizeBytes } = await req.json();
    if (!scanName || !fileName || !sizeBytes) {
      return NextResponse.json({ error: "scanName, fileName, and sizeBytes are required." }, { status: 400 });
    }
    const { data: report, error: insertErr } = await supabaseAdmin
      .from("reports")
      .insert({
        source_type: "client", client_id: session.id, scan_name: scanName,
        date_required: dateRequired || new Date().toISOString().slice(0, 10),
      }).select().single();
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    const folderId = await ensureReportFolder(report.id);
    const sessionUrl = await createResumableSession(folderId, fileName, mimeType || "application/octet-stream", sizeBytes, req.headers.get("origin"));
    return NextResponse.json({ sessionUrl, reportId: report.id });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not start upload" }, { status: 500 });
  }
}
