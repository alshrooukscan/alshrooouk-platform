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
  const [{ data: balances }, { data: doctors }, { data: clients }] = await Promise.all([
    supabaseAdmin.from("customer_ar_balances").select("*"),
    supabaseAdmin.from("doctors").select("id, name, clinic_name, phone, credit_limit_enabled, credit_limit"),
    supabaseAdmin.from("clients").select("id, name, credit_limit_enabled, credit_limit"),
  ]);

  const byId = new Map();
  (doctors || []).forEach((d) => byId.set(d.id, { ...d, customer_type: "doctor" }));
  (clients || []).forEach((c) => byId.set(c.id, { ...c, customer_type: "client" }));

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
        clinic_name: c.clinic_name || null,
        phone: c.phone || null,
        credit_limit_enabled: !!c.credit_limit_enabled,
        credit_limit: Number(c.credit_limit || 0),
      };
    })
    .sort((a, b) => b.balance - a.balance);

  return NextResponse.json({ customers: rows });
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
