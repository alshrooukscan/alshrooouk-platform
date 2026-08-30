import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { listFiles } from "../../../../../lib/googleDrive";

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "patient") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: patient } = await supabaseAdmin.from("patients").select("id, name, mobile, email").eq("id", session.id).single();
  const { data: auth } = await supabaseAdmin.from("patient_auth").select("must_change_password").eq("patient_id", session.id).single();
  const { data: visits } = await supabaseAdmin
    .from("visits")
    .select("id, scan_types, exam_date, payment_status, branches(name), doctors(name)")
    .eq("patient_id", session.id)
    .order("exam_date", { ascending: false });

  // Files explicitly linked to a specific visit - real, exact matches, not
  // guessed. This is what /api/drive/upload has always written to
  // patient_files; anything uploaded through that path already has this.
  const { data: linkedFiles } = await supabaseAdmin
    .from("patient_files")
    .select("id, visit_id, drive_file_id, file_name, created_at")
    .eq("patient_id", session.id);

  let driveFiles = [];
  const { data: folder } = await supabaseAdmin
    .from("drive_folder_index")
    .select("drive_folder_id")
    .eq("entity_type", "patient")
    .eq("entity_id", session.id)
    .maybeSingle();
  if (folder) {
    try {
      driveFiles = await listFiles(folder.drive_folder_id);
    } catch (e) {
      driveFiles = [];
    }
  }

  const linkedDriveIds = new Set((linkedFiles || []).map((f) => f.drive_file_id));
  const unlinkedDriveFiles = driveFiles.filter((f) => !linkedDriveIds.has(f.id));

  // Best-effort matching for older files that predate the explicit link:
  // attach an unlinked Drive file to whichever visit's exam_date is closest
  // to when the file was actually created in Drive, capped at 14 days apart
  // so an unrelated file doesn't get attached to the wrong scan just because
  // it's the nearest one chronologically.
  const visitsWithDates = (visits || []).filter((v) => v.exam_date);
  const bestEffortByVisit = {};
  const stillUnmatched = [];
  for (const file of unlinkedDriveFiles) {
    const fileDate = new Date(file.createdTime);
    let closest = null;
    let closestDiff = Infinity;
    for (const v of visitsWithDates) {
      const diff = Math.abs(new Date(v.exam_date).getTime() - fileDate.getTime());
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = v;
      }
    }
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
    if (closest && closestDiff <= FOURTEEN_DAYS_MS) {
      if (!bestEffortByVisit[closest.id]) bestEffortByVisit[closest.id] = [];
      bestEffortByVisit[closest.id].push(file);
    } else {
      stillUnmatched.push(file);
    }
  }

  // Attach both exact and best-effort files onto each visit directly, so the
  // page can render a scan's own results right on its own card.
  const visitsWithFiles = (visits || []).map((v) => {
    const exact = (linkedFiles || [])
      .filter((f) => f.visit_id === v.id)
      .map((f) => ({ id: f.drive_file_id, name: f.file_name, createdTime: f.created_at, webViewLink: `https://drive.google.com/file/d/${f.drive_file_id}/view`, exact: true }));
    const guessed = (bestEffortByVisit[v.id] || []).map((f) => ({ ...f, exact: false }));
    return { ...v, files: [...exact, ...guessed] };
  });

  // Checked fresh here, not read from the session token - see the identical
  // note in the client data route for why.
  return NextResponse.json({ patient, visits: visitsWithFiles, files: stillUnmatched, mustChangePassword: !!auth?.must_change_password });
}
