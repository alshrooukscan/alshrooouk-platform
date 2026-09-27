import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireGateway } from "../../../../lib/requireGateway";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Polled by the clinic's sync agent (see gateway/sync-agent/) to find visits
// that need a DICOM worklist entry pushed to the local Orthanc server before
// the scan. Nothing pushes from shscan.com to the clinic directly - Orthanc
// sits behind the clinic's own network, unreachable from Vercel - so the
// gateway pulls.
//
// A visit's dicom_study_uid/dicom_accession_number are generated here, once,
// and persisted immediately (not just returned), so a re-poll after a failed
// push returns the SAME identifiers rather than reserving a new pair every
// time. That is what keeps a retried worklist push idempotent.

// How long a visit may sit at 'pending' (handed out, never confirmed by
// /api/gateway/worklist-created) before it is handed out again. A normal push
// confirms within seconds and the gateway polls every 30s, so five minutes
// only ever catches a push that genuinely failed - it is never a second copy
// of one still in flight.
const PENDING_RETRY_AFTER_MS = 5 * 60 * 1000;

export async function GET(req) {
  const gateway = await requireGateway(req);
  if (!gateway) return NextResponse.json({ error: "Invalid gateway key." }, { status: 401 });

  // 'needs_resync' is set (by the patient-info edit flow) on a visit whose
  // worklist entry was already pushed once but the patient's name/DOB has
  // since changed - it's picked up here alongside brand-new visits, but
  // keeps its existing identifiers instead of getting new ones (see below).
  //
  // A visit still at 'pending' past PENDING_RETRY_AFTER_MS was handed out but
  // never confirmed: the push failed (Orthanc down, network blip), or it
  // succeeded and only the confirmation was lost. Either way it is handed out
  // again. Without this, a failed push left the visit at 'pending' forever -
  // and for a resync, whose stale entry the gateway deletes before pushing,
  // that meant a booking with no worklist entry at all. A null
  // dicom_worklist_pending_at is a visit that went pending before that column
  // existed, so it counts as stuck too.
  const retryCutoff = new Date(Date.now() - PENDING_RETRY_AFTER_MS).toISOString();
  const { data: pending } = await supabaseAdmin
    .from("visits")
    .select("id, exam_date, scan_types, patient_id, dicom_study_uid, dicom_accession_number, dicom_worklist_status, patients(name, dob)")
    .or(
      "dicom_worklist_status.is.null," +
        "dicom_worklist_status.eq.needs_resync," +
        `and(dicom_worklist_status.eq.pending,or(dicom_worklist_pending_at.is.null,dicom_worklist_pending_at.lt."${retryCutoff}"))`
    )
    .gte("exam_date", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    .order("exam_date", { ascending: true })
    .limit(20);

  if (!pending || pending.length === 0) return NextResponse.json({ entries: [] });

  const entries = [];
  for (const visit of pending) {
    const isResync = visit.dicom_worklist_status === "needs_resync";
    const isRetry = visit.dicom_worklist_status === "pending";
    // A resync or a retry keeps the identifiers already assigned - the booking
    // hasn't changed. Reusing them (rather than issuing a fresh pair, like a
    // brand-new visit gets below) is what lets the gateway find and remove
    // any entry already in Orthanc by AccessionNumber before pushing again.
    const reuseIds = (isResync || isRetry) && visit.dicom_study_uid && visit.dicom_accession_number;
    //
    // 2.25.<uuid-as-decimal> is a self-issued DICOM UID root that needs no OID
    // registration (DICOM PS3.5 Annex B) - fine for a UID generated per-study
    // by our own system rather than by the imaging equipment itself.
    const studyUid = reuseIds
      ? visit.dicom_study_uid
      : `2.25.${BigInt("0x" + crypto.randomUUID().replace(/-/g, "")).toString()}`;
    // AccessionNumber is DICOM VR "SH", 16 characters max.
    const accessionNumber = reuseIds
      ? visit.dicom_accession_number
      : `SH${visit.id.replace(/-/g, "").slice(0, 14).toUpperCase()}`;

    await supabaseAdmin
      .from("visits")
      .update({
        dicom_study_uid: studyUid,
        dicom_accession_number: accessionNumber,
        dicom_worklist_status: "pending",
        dicom_worklist_pending_at: new Date().toISOString(),
      })
      .eq("id", visit.id);

    entries.push({
      visitId: visit.id,
      patientId: visit.patient_id,
      patientName: visit.patients?.name || "",
      patientBirthDate: visit.patients?.dob || null,
      examDate: visit.exam_date,
      scanTypes: visit.scan_types || [],
      dicomStudyUid: studyUid,
      dicomAccessionNumber: accessionNumber,
      // A retried push may have reached Orthanc the first time with only the
      // confirmation lost, so an entry can already exist under this
      // AccessionNumber. `resync` is what tells the gateway to delete any such
      // entry before pushing (worklistPusher.js) - set for retries too, so the
      // machine never shows the same booking twice, and so this needs no
      // change to the gateway already running at the clinic. `retry` only
      // says why.
      resync: isResync || isRetry,
      retry: isRetry,
    });
  }

  return NextResponse.json({ entries });
}
