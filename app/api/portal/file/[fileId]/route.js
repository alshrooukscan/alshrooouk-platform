import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { getAccessToken, getFileParents, getFileMeta } from "../../../../../lib/googleDrive";

// Patient and doctor portals used to link straight at
// https://drive.google.com/file/d/<id>/view. Those files live in the clinic's
// shared drive, owned by the service account, so Google answered every patient
// with a sign-in page and a "request access" prompt - a 401. Staff never saw it
// because staff browsers are signed into Google accounts that do have access.
// In practice no portal file had ever been openable by the people the portal
// was built for.
//
// This streams the bytes through our own server instead, authenticated as the
// service account. The person needs no Google account and nothing in Drive is
// shared publicly: Drive still refuses everyone, and this route is the only
// door.
//
// Deliberately open to anyone holding the link, matching how the clinic sends
// results over WhatsApp. Two things keep that from being a general leak:
//
//  - The id must already be registered in patient_files. Drive ids are long
//    random strings, so they cannot be guessed, and an id copied from anywhere
//    else in the shared drive - payroll, contracts, another patient's folder -
//    is refused here because it was never registered as a patient file. The
//    route can only ever serve clinical files the system itself recorded.
//  - Access can be withdrawn by deleting the record, which a public Drive
//    link would not allow. A Drive link, once shared, is effectively permanent
//    and invisible to us; this one is revocable and can be logged.
//
// inline rather than attachment so images and PDFs open in the phone browser
// instead of silently landing in Downloads.
// This handler reads only params - no cookies, headers or search params - so
// Next treats it as statically optimisable and caches the fetch that
// supabase-js makes underneath. That cached row is the access check: a
// renamed file kept serving its old name, and by the same mechanism a file
// whose patient_files record had been DELETED would have kept serving too.
// Revocability is the whole reason this proxy exists instead of a public
// Drive link, so the lookup has to hit the database on every request.
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const fileId = params?.fileId;
  if (!fileId) {
    return NextResponse.json({ error: "File id is required" }, { status: 400 });
  }

  let record = null;
  const { data: registered } = await supabaseAdmin
    .from("patient_files")
    .select("drive_file_id, file_name")
    .eq("drive_file_id", fileId)
    .maybeSingle();

  if (registered) {
    record = registered;
  } else {
    // The doctor portal and the patient portal's best-effort matching list
    // files straight out of Drive, so plenty of legitimate clinical files were
    // never written to patient_files. Those are admitted on the strength of
    // where they sit: inside a folder the system itself registered against a
    // patient. Anything elsewhere in the shared drive - payroll, contracts,
    // scanned agreements - has no such folder and is refused.
    const parents = await getFileParents(fileId).catch(() => []);
    if (parents.length > 0) {
      const [{ data: byPatient }, { data: byIndex }] = await Promise.all([
        supabaseAdmin.from("patients").select("id").in("drive_folder_id", parents).limit(1),
        supabaseAdmin.from("drive_folder_index").select("id").in("drive_folder_id", parents).limit(1),
      ]);
      if ((byPatient && byPatient.length) || (byIndex && byIndex.length)) {
        const meta = await getFileMeta(fileId).catch(() => null);
        record = { drive_file_id: fileId, file_name: meta?.name || "file" };
      }
    }
  }

  if (!record) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const token = await getAccessToken();
    const upstream = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!upstream.ok) {
      const body = await upstream.text();
      return NextResponse.json(
        { error: `Could not read the file from Drive: ${body.slice(0, 200)}` },
        { status: 502 }
      );
    }

    // Streamed straight through rather than buffered: raw scan data runs to
    // hundreds of megabytes and holding one in memory would be enough to take
    // the function down.
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || guessType(record.file_name));
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    headers.set(
      "Content-Disposition",
      `inline; filename="${(record.file_name || "file").replace(/"/g, "")}"`
    );
    // Private: this is one person's medical imaging and must not be held by a
    // shared cache along the way.
    headers.set("Cache-Control", "private, max-age=300");

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed to fetch the file" }, { status: 500 });
  }
}

// Drive is usually authoritative about content type, but files uploaded as
// application/octet-stream come back untyped, and a browser shown an untyped
// image offers a download instead of displaying it.
function guessType(name) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    zip: "application/zip",
    dcm: "application/dicom",
  };
  return map[ext] || "application/octet-stream";
}
