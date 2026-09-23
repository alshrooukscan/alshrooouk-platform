import { NextResponse } from "next/server";
import { requireGateway } from "../../../../lib/requireGateway";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Confirms the gateway successfully created the worklist entry in the local
// Orthanc server for a visit returned by /api/gateway/worklist-queue. Until
// this fires, the visit stays dicom_worklist_status='pending' and is handed
// out again on the next poll - a push that failed partway (network blip,
// Orthanc restart mid-call) is simply retried with the same identifiers.
export async function POST(req) {
  const gateway = await requireGateway(req);
  if (!gateway) return NextResponse.json({ error: "Invalid gateway key." }, { status: 401 });

  const { visitId, dicomStudyUid } = await req.json();
  if (!visitId || !dicomStudyUid) {
    return NextResponse.json({ error: "visitId and dicomStudyUid are required" }, { status: 400 });
  }

  const { data: visit } = await supabaseAdmin
    .from("visits")
    .select("id, dicom_study_uid")
    .eq("id", visitId)
    .maybeSingle();

  if (!visit || visit.dicom_study_uid !== dicomStudyUid) {
    // The identifiers no longer match what shscan.com holds - most likely the
    // visit was re-issued a new pair by a later worklist-queue poll while this
    // call was in flight. Report it rather than silently marking the wrong
    // attempt as created.
    return NextResponse.json({ error: "dicomStudyUid does not match the visit's current identifiers." }, { status: 409 });
  }

  await supabaseAdmin.from("visits").update({ dicom_worklist_status: "worklist_created" }).eq("id", visitId);
  await supabaseAdmin.from("gateway_sync_log").insert({
    event_type: "worklist_created",
    dicom_study_uid: dicomStudyUid,
    visit_id: visitId,
  });

  return NextResponse.json({ ok: true });
}
