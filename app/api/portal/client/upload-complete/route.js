import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { getFileMeta } from "../../../../../lib/googleDrive";

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { fileId, reportId, fileName } = await req.json();
    if (!fileId || !reportId || !fileName) {
      return NextResponse.json({ error: "fileId, reportId, and fileName are required" }, { status: 400 });
    }
    const file = await getFileMeta(fileId);
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("reports")
      .update({ client_uploaded_file_url: file.webViewLink || null, client_uploaded_file_name: fileName })
      .eq("id", reportId).select().single();
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, report: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not finalize upload" }, { status: 500 });
  }
}
