import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { buildAccountEntries } from "../../../../../lib/arStatement";
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
  // What the clinic owes, not what this doctor owes. Orders are placed and
  // debts run at clinic level - clinic 506 has four doctors - so the balance is
  // the clinic's and every doctor at it sees the same figure. Charges minus
  // payments, so a part payment shows the remainder rather than the original.
  // Counted against the clinic AND against the doctor. Deliveries used to book
  // the charge on the doctor while this only read clinic rows, so a delivered
  // order left the balance unmoved - the money was recorded where nothing
  // totalled it. Charges are booked to the clinic now, but only 59 of 166
  // doctors have a clinic_code that resolves to one, so a doctor row is still
  // the honest destination for the rest. Reading both means the amount is
  // never invisible, whichever way it was written.
  let clinicOwes = 0;
  let clinicName = null;
  const owners = [{ type: "doctor", id: doctor?.id }];

  if (doctor?.clinic_code) {
    const { data: clinic } = await supabaseAdmin
      .from("clinics")
      .select("id, name")
      .eq("code", doctor.clinic_code)
      .maybeSingle();
    if (clinic) {
      clinicName = clinic.name;
      owners.push({ type: "clinic", id: clinic.id });
    }
  }

  // What the balance is made of: every sale and order with its items at the
  // price charged, every payment and return, oldest first. Dr. Amr Mansour
  // (clinic 358, 30 Oct 2026) saw "owes 415" over an empty Supply Orders tab -
  // the 415 came from items picked up at reception, which that tab never shows.
  let account = { entries: [], totals: { charged: 0, paid: 0, balance: 0 } };
  try {
    account = await buildAccountEntries(owners.filter((o) => o.id));
  } catch { /* the balance below still shows */ }
  clinicOwes = account.totals.balance;
  // Only what the doctor needs, newest stretch first: everything since the
  // account was last clear, plus up to 40 earlier lines for the full history.
  let openFrom = 0;
  account.entries.forEach((e, i) => { if (e.running <= 0.005) openFrom = i + 1; });
  const trim = (e) => ({ id: e.id, date: e.date, brand: e.brand, kind: e.kind, label: e.label, receipt_no: e.receipt_no,
    payment_method: e.payment_method, note: e.note, amount: e.amount, lines: e.lines, difference: e.difference, running: e.running });
  const accountOpen = account.entries.slice(openFrom).map(trim);
  const accountHistory = account.entries.slice(Math.max(0, openFrom - 40), openFrom).map(trim);

  return NextResponse.json({
    doctor,
    visits: visits || [],
    clinicOwes: Math.round(clinicOwes * 100) / 100,
    clinicName,
    accountOpen,
    accountHistory,
    mustChangePassword: session.impersonated ? false : !!doctor?.must_change_password,
    impersonatedBy: session.impersonatedBy || null,
  });
}
