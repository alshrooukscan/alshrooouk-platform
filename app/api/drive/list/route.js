import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { listFilesGrouped } from "../../../../lib/googleDrive";

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

    // Fall back to the patient row before giving up. Returning an empty list on a
    // missing index row is indistinguishable from "this patient genuinely has no
    // files", which is exactly how a folder-mapping problem stays invisible.
    let folderId = existing?.drive_folder_id;
    if (!folderId) {
      const { data: p } = await supabaseAdmin
        .from("patients")
        .select("drive_folder_id")
        .eq("id", patientId)
        .maybeSingle();
      folderId = p?.drive_folder_id;
    }
    if (!folderId) {
      return NextResponse.json({ files: [] });
    }

    const files = await listFilesGrouped(folderId);

    // Some clinics keep several same-named patients in ONE physical folder, so
    // listing the folder raw would show each of them the others' scans. Files
    // that patient_files attributes to a DIFFERENT patient are filtered out;
    // anything unattributed still shows, so nothing silently disappears.
    const { data: owned } = await supabaseAdmin
      .from("patient_files")
      .select("drive_file_id, patient_id")
      .in("drive_file_id", files.map((f) => f.id).filter(Boolean));

    const ownerOf = new Map((owned || []).map((r) => [r.drive_file_id, r.patient_id]));
    const visible = files.filter((f) => {
      const owner = ownerOf.get(f.id);
      return !owner || owner === patientId;
    });

    return NextResponse.json({ files: visible });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
