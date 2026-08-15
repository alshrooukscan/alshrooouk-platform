import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { listFiles } from "../../../../lib/googleDrive";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get("patientId");
    if (!patientId) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin
      .from("drive_folder_index")
      .select("drive_folder_id")
      .eq("entity_type", "patient")
      .eq("entity_id", patientId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ files: [] });
    }

    const files = await listFiles(existing.drive_folder_id);
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
