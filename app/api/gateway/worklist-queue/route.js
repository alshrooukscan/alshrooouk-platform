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
export async function GET(req) {
  const gateway = await requireGateway(req);
  if (!gateway) return NextResponse.json({ error: "Invalid gateway key." }, { status: 401 });

  const { data: pending } = await supabaseAdmin
    .from("visits")
    .select("id, exam_date, scan_types, patient_id, patients(name, dob)")
    .is("dicom_worklist_status", null)
    .gte("exam_date", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    .order("exam_date", { ascending: true })
    .limit(20);

  if (!pending || pending.length === 0) return NextResponse.json({ entries: [] });

  const entries = [];
  for (const visit of pending) {
    // 2.25.<uuid-as-decimal> is a self-issued DICOM UID root that needs no OID
    // registration (DICOM PS3.5 Annex B) - fine for a UID generated per-study
    // by our own system rather than by the imaging equipment itself.
    const studyUid = `2.25.${BigInt("0x" + crypto.randomUUID().replace(/-/g, "")).toString()}`;
    // AccessionNumber is DICOM VR "SH", 16 characters max.
    const accessionNumber = `SH${visit.id.replace(/-/g, "").slice(0, 14).toUpperCase()}`;

    await supabaseAdmin
      .from("visits")
      .update({ dicom_study_uid: studyUid, dicom_accession_number: accessionNumber, dicom_worklist_status: "pending" })
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
    });
  }

  return NextResponse.json({ entries });
}
