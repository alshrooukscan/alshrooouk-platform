import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireStaff } from "../../../lib/requireStaff";

// A20: delivery staff, reception, admins, store manager and store admin may
// collect debt. Roles on this system are free text, so we go through the
// permission flags plus the debt_collector skill rather than title matching.
function canCollect(staff) {
  if (!staff) return false;
  return (
    staff.role === "admin" ||
    staff.permissions?.stock === true ||
    staff.permissions?.reception === true ||
    staff.permissions?.debt_collection === true
  );
}

function canOverrideLimit(staff) {
  // A19: above the credit limit, only an admin may approve.
  return staff?.role === "admin";
}

// The cash ledger is keyed on employees, not staff_profiles. Without this link
// cash collected cannot be attributed and would not appear in Cash In Hand.
async function employeeIdFor(staff) {
  if (!staff?.email) return null;
  const { data } = await supabaseAdmin
    .from("employees")
    .select("id")
    .ilike("staff_account_email", staff.email)
    .maybeSingle();
  return data?.id || null;
}

export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canCollect(staff)) {
    return NextResponse.json({ error: "You don't have access to debt collection." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");

  // Single customer: full statement, newest first.
  if (customerId) {
    const { data: rows } = await supabaseAdmin
      .from("customer_ar_ledger")
      .select("*")
      .eq("customer_id", customerId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    return NextResponse.json({ ledger: rows || [] });
  }

  // Everyone who currently owes something, with their limit alongside.
  // Clinics were missing, and every balance on the page is a clinic - so every
  // row read "Unknown". That is mine: when counter sales and deliveries were
  // moved onto the clinic rather than the doctor, this lookup was never told.
  const [{ data: balances }, { data: doctors }, { data: clients }, { data: clinics }] = await Promise.all([
    supabaseAdmin.from("customer_ar_balances").select("*"),
    supabaseAdmin.from("doctors").select("id, name, clinic_name, phone, clinic_code, credit_limit_enabled, credit_limit"),
    supabaseAdmin.from("clients").select("id, name, credit_limit_enabled, credit_limit"),
    supabaseAdmin.from("clinics").select("id, name, code"),
  ]);

  const byId = new Map();
  (doctors || []).forEach((d) => byId.set(d.id, { ...d, customer_type: "doctor" }));
  (clients || []).forEach((c) => byId.set(c.id, { ...c, customer_type: "client" }));
  // A clinic often has no name recorded - 237 and 129 among them - so the code
  // carries the identity. "Clinic 237" is something reception can act on;
  // "Unknown" is not.
  (clinics || []).forEach((c) =>
    byId.set(c.id, {
      name: c.name || (c.code ? `Clinic ${c.code}` : null),
      clinic_code: c.code,
      customer_type: "clinic",
    })
  );

  // Which doctors sit behind each clinic, so a debt can be chased by name.
  const doctorsByClinicCode = new Map();
  (doctors || []).forEach((d) => {
    if (!d.clinic_code) return;
    if (!doctorsByClinicCode.has(d.clinic_code)) doctorsByClinicCode.set(d.clinic_code, []);
    doctorsByClinicCode.get(d.clinic_code).push(d.name);
  });

  const rows = (balances || [])
    .filter((b) => Number(b.balance) !== 0)
    .map((b) => {
      const c = byId.get(b.customer_id) || {};
      return {
        customer_type: b.customer_type,
        customer_id: b.customer_id,
        internal_brand: b.internal_brand,
        brand: b.brand,
        balance: Number(b.balance),
        name: c.name || b.internal_brand || "Unknown",
        clinic_code: c.clinic_code || null,
        doctors: c.clinic_code ? doctorsByClinicCode.get(c.clinic_code) || [] : [],
        clinic_name: c.clinic_name || null,
        phone: c.phone || null,
        credit_limit_enabled: !!c.credit_limit_enabled,
        credit_limit: Number(c.credit_limit || 0),
      };
    })
    .sort((a, b) => b.balance - a.balance);

  // What each debt is actually made of. A clinic owing 9,920 EGP is not
  // something reception can discuss without knowing which orders it came from,
  // and the ledger already carries the reference on every charge.
  const owingIds = rows.map((r) => r.customer_id);
  const detailByCustomer = {};
  if (owingIds.length) {
    const { data: charges } = await supabaseAdmin
      .from("customer_ar_ledger")
      .select("customer_id, brand, amount, direction, reference_type, reference_id, note, entry_date")
      .in("customer_id", owingIds)
      .eq("direction", "charge")
      .order("entry_date", { ascending: false })
      .limit(400);

    // Receipt numbers for counter sales, so a line reads as something that
    // exists on paper rather than an internal id.
    const saleIds = [...new Set((charges || []).filter((c) => c.reference_type === "counter_sale" && c.reference_id).map((c) => c.reference_id))];
    let receiptById = {};
    if (saleIds.length) {
      const { data: sales } = await supabaseAdmin.from("counter_sales").select("id, receipt_no").in("id", saleIds);
      receiptById = Object.fromEntries((sales || []).map((x) => [x.id, x.receipt_no]));
    }

    for (const c of charges || []) {
      (detailByCustomer[c.customer_id] ||= []).push({
        brand: c.brand,
        amount: Number(c.amount),
        entry_date: c.entry_date,
        reference: receiptById[c.reference_id] || null,
        reference_type: c.reference_type,
        note: c.note,
      });
    }
  }
  rows.forEach((r) => { r.charges = (detailByCustomer[r.customer_id] || []).filter((c) => c.brand === r.brand).slice(0, 8); });

  // Patients who owe the centre for a scan. This never appeared here at all -
  // 13,920 EGP across 24 visits was uncollectable simply because nobody could
  // see it. It does not live in the AR ledger: a visit carries its own charge
  // and what has been paid against it, so the debt is the difference.
  const { data: unpaidVisits } = await supabaseAdmin
    .from("visits")
    .select("id, patient_id, exam_date, exam_time, scan_types, amount_due, amount_paid, discount_pct, discount_reason, patients(name, mobile)")
    .order("exam_date", { ascending: false })
    .limit(500);

  const patientDebts = (unpaidVisits || [])
    .map((v) => ({
      visit_id: v.id,
      patient_id: v.patient_id,
      name: v.patients?.name || "Unknown patient",
      phone: v.patients?.mobile || null,
      exam_date: v.exam_date,
      exam_time: v.exam_time,
      scan_types: v.scan_types || [],
      amount_due: Number(v.amount_due || 0),
      amount_paid: Number(v.amount_paid || 0),
      // amount_due is already net of the discount - a 2,500 scan at 20% is
      // stored as 2,000 - so the balance needs no further adjustment. The
      // percentage is sent so the page can show it: a discount that is applied
      // but never displayed cannot be checked by anyone, which is exactly how a
      // wrong one survives.
      discount_pct: Number(v.discount_pct || 0),
      discount_reason: v.discount_reason || null,
      balance: Number(v.amount_due || 0) - Number(v.amount_paid || 0),
    }))
    .filter((v) => v.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  // Same reasoning as the counter: the page has to know before the collection
  // whether this login can be attributed automatically, so it can ask at the
  // point of collection rather than refuse afterwards.
  const selfEmployeeId = await employeeIdFor(staff);
  const { data: staffRows } = await supabaseAdmin
    .from("employees")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return NextResponse.json({ customers: rows, patientDebts, staff: staffRows || [], selfEmployeeId: selfEmployeeId || null });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canCollect(staff)) {
    return NextResponse.json({ error: "You don't have access to debt collection." }, { status: 403 });
  }

  const body = await req.json();
  const { action, customerType, customerId, brand, amount, note } = body;

  if (!action || !customerType || !customerId || !brand) {
    return NextResponse.json(
      { error: "action, customerType, customerId and brand are required" },
      { status: 400 }
    );
  }

  if (action === "charge") {
    const overrideRequested = !!body.overrideLimit;
    if (overrideRequested && !canOverrideLimit(staff)) {
      return NextResponse.json(
        { error: "Only an admin can approve a charge above the customer's credit limit." },
        { status: 403 }
      );
    }
    const { data, error } = await supabaseAdmin.rpc("record_ar_charge", {
      p_customer_type: customerType,
      p_customer_id: customerId,
      p_brand: brand,
      p_amount: Number(amount),
      p_reference_type: body.referenceType || null,
      p_reference_id: body.referenceId || null,
      p_note: note || null,
      p_staff_id: staff.id,
      p_staff_name: staff.name,
      p_override_limit: overrideRequested,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabaseAdmin.from("activity_log").insert({
      actor_id: staff.id,
      actor_name: staff.name,
      actor_type: staff.role === "admin" ? "admin" : "employee",
      action: "ar_charge_recorded",
      entity_type: "customer_ar_ledger",
      entity_id: data?.ledger_id || null,
      details: { customerType, customerId, brand, amount: Number(amount), override: overrideRequested },
    });

    return NextResponse.json({ ok: true, result: data });
  }

  if (action === "payment") {
    const method = (body.paymentMethod || "cash").toLowerCase();

    // Cash has to land in a named person's custody, and that person has to
    // confirm they are holding it. Both are enforced again in the database.
    let employeeId = null;
    if (method === "cash") {
      employeeId = body.collectedByEmployeeId || (await employeeIdFor(staff));
      if (!employeeId) {
        return NextResponse.json(
          {
            error:
              "Your staff login isn't linked to an employee record, so cash can't be attributed to you. Ask an admin to link it, or choose who collected it.",
          },
          { status: 400 }
        );
      }
      if (!body.cashAcknowledged) {
        return NextResponse.json(
          { error: "Please confirm the cash has been received before recording it." },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabaseAdmin.rpc("record_debt_payment", {
      p_customer_type: customerType,
      p_customer_id: customerId,
      p_brand: brand,
      p_amount: Number(amount),
      p_payment_method: method,
      p_staff_id: staff.id,
      p_staff_name: staff.name,
      p_employee_id: employeeId,
      p_cash_acknowledged: !!body.cashAcknowledged,
      p_note: note || null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabaseAdmin.from("activity_log").insert({
      actor_id: staff.id,
      actor_name: staff.name,
      actor_type: staff.role === "admin" ? "admin" : "employee",
      action: "debt_payment_collected",
      entity_type: "customer_ar_ledger",
      entity_id: data?.ledger_id || null,
      details: {
        customerType,
        customerId,
        brand,
        amount: Number(amount),
        method,
        receipt: data?.receipt_no,
      },
    });

    return NextResponse.json({ ok: true, result: data });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
