import { NextResponse } from "next/server";
import { requireGateway } from "../../../../lib/requireGateway";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Polled by the clinic's sync agent alongside worklist-queue. Deleting a
// visit (see visits/[id]/route.js) used to leave its Orthanc worklist entry
// behind indefinitely - nothing told the gateway the booking was gone, so
// the client's machine kept showing a canceled visit until Orthanc's own
// DeleteWorklistsOnStableStudy or 48h DeleteWorklistsDelay eventually swept
// it. This queue is keyed by dicom_study_uid, which every push already logs,
// so no new column or table was needed.
export async function GET(req) {
  const gateway = await requireGateway(req);
  if (!gateway) return NextResponse.json({ error: "Invalid gateway key." }, { status: 401 });

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: requested } = await supabaseAdmin
    .from("gateway_sync_log")
    .select("dicom_study_uid")
    .eq("event_type", "worklist_delete_requested")
    .gte("created_at", since)
    .limit(200);

  if (!requested || requested.length === 0) return NextResponse.json({ studyUids: [] });

  const { data: done } = await supabaseAdmin
    .from("gateway_sync_log")
    .select("dicom_study_uid")
    .eq("event_type", "worklist_deleted")
    .gte("created_at", since)
    .limit(200);

  const doneSet = new Set((done || []).map((r) => r.dicom_study_uid));
  const studyUids = [...new Set(requested.map((r) => r.dicom_study_uid).filter((uid) => uid && !doneSet.has(uid)))].slice(0, 20);

  return NextResponse.json({ studyUids });
}

// Confirms the gateway removed the Orthanc worklist entry (or found it
// already gone - that's success too, not an error) for a deleted visit's
// study, so the next poll stops handing it out.
export async function POST(req) {
  const gateway = await requireGateway(req);
  if (!gateway) return NextResponse.json({ error: "Invalid gateway key." }, { status: 401 });

  const { dicomStudyUid } = await req.json();
  if (!dicomStudyUid) return NextResponse.json({ error: "dicomStudyUid is required" }, { status: 400 });

  await supabaseAdmin.from("gateway_sync_log").insert({
    event_type: "worklist_deleted",
    dicom_study_uid: dicomStudyUid,
  });

  return NextResponse.json({ ok: true });
}
