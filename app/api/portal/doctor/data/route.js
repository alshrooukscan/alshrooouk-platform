import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";


// Records are withheld until the account is off its staff-issued temporary
// password. The redirect on the portal page is only a client-side courtesy;
// on its own it left this data reachable by calling the route directly with a
// temporary password that had travelled over WhatsApp and may be sitting in
// someone else's chat history.
//
// Returns 200 with mustChangePassword set rather than an error status, because
// the portal page reads exactly this response to decide to redirect - failing
// the request would strand the person on a broken screen instead of sending
// them to the form that fixes it.
function passwordChangeRequired() {
  return NextResponse.json({ mustChangePassword: true, gated: true });
}

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: doctor } = await supabaseAdmin.from("doctors").select("id, name, clinic_name, clinic_code, must_change_password").eq("id", session.id).single();

  // Clinic-wide access: a doctor sees every case referred by any doctor sharing
  // their clinic_code, not just their own referrals - confirmed client decision
  // for multi-doctor clinics, including payment/discount info. A doctor with no
  // clinic_code (shouldn't normally happen) falls back to their own referrals
  // only, so this can never accidentally expose the whole system.
  let clinicDoctorIds = [session.id];
  if (doctor?.clinic_code) {
    const { data: clinicDoctors } = await supabaseAdmin
      .from("doctors")
      .select("id")
      .eq("clinic_code", doctor.clinic_code);
    if (clinicDoctors?.length) clinicDoctorIds = clinicDoctors.map((d) => d.id);
  }

  const { data: visits } = await supabaseAdmin
    .from("visits")
    .select("id, patient_id, doctor_id, scan_types, exam_date, scanned, raw_data_uploaded, report_done, payment_status, amount_due, amount_paid, patients(name, mobile), doctors(name), visit_payments(payment_method)")
    .in("doctor_id", clinicDoctorIds)
    .order("exam_date", { ascending: false });

  // Checked fresh here, not read from the session token - see the identical
  // note in the client data route for why.
    // Impersonating admins are exempt: they are inspecting the account, not
  // using it, and cannot set someone else's password.
  if (!session.impersonated && doctor?.must_change_password) return passwordChangeRequired();
  return NextResponse.json({ doctor, visits: visits || [], mustChangePassword: session.impersonated ? false : !!doctor?.must_change_password, impersonatedBy: session.impersonatedBy || null });
}
