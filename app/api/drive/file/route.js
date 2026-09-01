import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";
import { getFileMeta, createResumableSession, getAccessToken } from "../../../../lib/googleDrive";

// Deleting or replacing a file a colleague uploaded is a destructive act on
// clinical data, so it needs the Patients module, not merely a login.
function canManageFiles(staff) {
  if (!staff) return false;
  if (staff.role === "admin") return true;
  return staff.permissions?.patients === true;
}

// DELETE - trash the file in Drive and drop its record.
//
// The service account can trash but cannot permanently delete, which is the
// safer behaviour anyway: a mistaken removal is recoverable from Drive's bin
// for 30 days rather than gone the moment someone mis-clicks.
export async function DELETE(req) {
  const staff = await requireStaff(req);
  if (!canManageFiles(staff)) {
    return NextResponse.json({ error: "You don't have permission to remove patient files." }, { status: 403 });
  }

  const { fileId, patientId } = await req.json();
  if (!fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 });

  const { data: record } = await supabaseAdmin
    .from("patient_files")
    .select("id, patient_id, file_name, file_type, visit_id")
    .eq("drive_file_id", fileId)
    .maybeSingle();

  // Confirm the file really sits under the patient the caller says it does, so
  // a wrong or stale id cannot trash a file belonging to someone else.
  if (record && patientId && record.patient_id !== patientId) {
    return NextResponse.json({ error: "That file does not belong to this patient." }, { status: 403 });
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: true }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Drive refused to remove the file: ${body.slice(0, 200)}` }, { status: 500 });
  }

  if (record) {
    await supabaseAdmin.from("patient_files").delete().eq("id", record.id);
  }

  await supabaseAdmin.from("activity_log").insert({
    actor_id: staff.id,
    actor_name: staff.name,
    actor_type: staff.role === "admin" ? "admin" : "employee",
    action: "deleted_patient_file",
    entity_type: "patient",
    entity_id: record?.patient_id || patientId || null,
    // The Drive id is kept so a file trashed by mistake can be found and
    // restored from the bin without guessing which one it was.
    details: { fileName: record?.file_name, driveFileId: fileId, visitId: record?.visit_id },
  });

  return NextResponse.json({ ok: true });
}

// POST - start a replacement upload into the SAME folder the original sits in,
// so a corrected file never drifts into a different visit than the one it fixes.
export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canManageFiles(staff)) {
    return NextResponse.json({ error: "You don't have permission to replace patient files." }, { status: 403 });
  }

  const { fileId, fileName, mimeType, sizeBytes } = await req.json();
  if (!fileId || !fileName) {
    return NextResponse.json({ error: "fileId and fileName are required" }, { status: 400 });
  }

  const meta = await getFileMeta(fileId);
  const parent = meta.parents?.[0];
  if (!parent) return NextResponse.json({ error: "Could not find the original file's folder." }, { status: 500 });

  const sessionUrl = await createResumableSession(
    parent,
    fileName,
    mimeType || "application/octet-stream",
    sizeBytes,
    req.headers.get("origin")
  );

  return NextResponse.json({ sessionUrl });
}

// PATCH - finish a replacement: point the record at the new file, then trash
// the old one. Ordered this way so a failure here leaves the patient with two
// files rather than none.
export async function PATCH(req) {
  const staff = await requireStaff(req);
  if (!canManageFiles(staff)) {
    return NextResponse.json({ error: "You don't have permission to replace patient files." }, { status: 403 });
  }

  const { oldFileId, newFileId, fileName } = await req.json();
  if (!oldFileId || !newFileId) {
    return NextResponse.json({ error: "oldFileId and newFileId are required" }, { status: 400 });
  }

  const { data: record } = await supabaseAdmin
    .from("patient_files")
    .select("id, patient_id")
    .eq("drive_file_id", oldFileId)
    .maybeSingle();

  if (record) {
    await supabaseAdmin
      .from("patient_files")
      .update({
        drive_file_id: newFileId,
        file_name: fileName || null,
        uploaded_by_name: staff.name,
        uploaded_by_email: staff.email,
      })
      .eq("id", record.id);
  }

  await fetch(`https://www.googleapis.com/drive/v3/files/${oldFileId}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });

  await supabaseAdmin.from("activity_log").insert({
    actor_id: staff.id,
    actor_name: staff.name,
    actor_type: staff.role === "admin" ? "admin" : "employee",
    action: "replaced_patient_file",
    entity_type: "patient",
    entity_id: record?.patient_id || null,
    details: { fileName, replacedDriveFileId: oldFileId, newDriveFileId: newFileId },
  });

  return NextResponse.json({ ok: true });
}
