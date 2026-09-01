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
    // NOTE: no early return when the patient has no folder. Recovered files and
    // files attached before a folder was provisioned still have patient_files
    // rows, and bailing out here is what kept them invisible.
    const files = folderId ? await listFilesGrouped(folderId) : [];

    // Some clinics keep several same-named patients in ONE physical folder, so
    // listing the folder raw would show each of them the others' scans. Files
    // that patient_files attributes to a DIFFERENT patient are filtered out;
    // anything unattributed still shows, so nothing silently disappears.
    const driveIds = files.map((f) => f.id).filter(Boolean);
    const { data: owned } = driveIds.length
      ? await supabaseAdmin
          .from("patient_files")
          .select("drive_file_id, patient_id")
          .in("drive_file_id", driveIds)
      : { data: [] };

    const ownerOf = new Map((owned || []).map((r) => [r.drive_file_id, r.patient_id]));
    const visible = files.filter((f) => {
      const owner = ownerOf.get(f.id);
      return !owner || owner === patientId;
    });

    // Safety net: anything patient_files records for this patient that the Drive
    // walk did not return still gets shown. A file recorded in the database but
    // absent from the listing is exactly the failure this endpoint keeps
    // producing - folder moved, nested deeper than expected, or uploaded
    // somewhere else - and silently dropping it is what made it invisible for
    // weeks. Better to surface it than to pretend it does not exist.
    const seen = new Set(visible.map((f) => f.id));
    const { data: recorded } = await supabaseAdmin
      .from("patient_files")
      .select("drive_file_id, file_name, created_at")
      .eq("patient_id", patientId);

    const missing = (recorded || []).filter((r) => r.drive_file_id && !seen.has(r.drive_file_id));
    const recovered = missing.map((r) => ({
      id: r.drive_file_id,
      name: r.file_name,
      createdTime: r.created_at,
      webViewLink: `https://drive.google.com/file/d/${r.drive_file_id}/view`,
      groupLabel: null,
    }));

    return NextResponse.json({ files: [...visible, ...recovered] });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
