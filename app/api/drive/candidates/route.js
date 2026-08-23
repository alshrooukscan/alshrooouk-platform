import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getFileParents } from "../../../../lib/googleDrive";

async function requireStaff(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return null;
  return userData.user;
}

// Item 2: for each pending Drive match candidate, check whether the candidate
// folder actually sits inside the referring doctor's own Drive folder. This is
// corroboration, not a guess from name similarity alone.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: candidates } = await supabaseAdmin
    .from("drive_match_candidates")
    .select("*")
    .eq("status", "pending")
    .order("similarity", { ascending: false });
  const list = candidates || [];

  const patientIds = [...new Set(list.map((c) => c.patient_id))];
  const { data: visitRows } = patientIds.length
    ? await supabaseAdmin
        .from("visits")
        .select("patient_id, doctors(id, name, clinic_code, drive_folder_id)")
        .in("patient_id", patientIds)
        .not("doctor_id", "is", null)
        .order("exam_date", { ascending: false })
    : { data: [] };
  const doctorByPatient = {};
  for (const v of visitRows || []) {
    if (!doctorByPatient[v.patient_id] && v.doctors) doctorByPatient[v.patient_id] = v.doctors;
  }

  // Look up each candidate's real Drive parent, in parallel, and compare against
  // the referring doctor's own linked folder. Folders with no referring doctor on
  // file (walk-ins, root-level patients) can never get this corroboration -
  // that's expected, not a bug, they stay manual-review only.
  const enriched = await Promise.all(
    list.map(async (c) => {
      const referringDoctor = doctorByPatient[c.patient_id] || null;
      let driveConfirmed = false;
      let parentLookupFailed = false;
      if (referringDoctor?.drive_folder_id) {
        try {
          const parents = await getFileParents(c.drive_folder_id);
          driveConfirmed = parents.includes(referringDoctor.drive_folder_id);
        } catch {
          parentLookupFailed = true;
        }
      }
      return { ...c, referringDoctor, driveConfirmed, parentLookupFailed };
    })
  );

  return NextResponse.json({ candidates: enriched });
}
