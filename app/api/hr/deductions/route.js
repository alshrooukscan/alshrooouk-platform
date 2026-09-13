import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";

// The deduction review queue. Detection is not a decision: a row in
// payroll_deductions has never cost anyone anything. Approving it is what
// writes the frozen adjustment line, and that is why approving is the only
// thing here an ordinary HR user cannot do alone without leaving their name.

function canHr(staff) {
  return staff && (staff.role === "admin" || staff.permissions?.hr === true);
}

export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";

  const { data: rows, error } = await supabaseAdmin
    .from("payroll_deductions")
    .select("*, employees!inner(name, hr_id, acknowledgement_on_file)")
    .eq("status", status)
    .order("detected_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: settings } = await supabaseAdmin.from("payroll_settings").select("*").maybeSingle();

  return NextResponse.json({
    deductions: (rows || []).map((r) => ({
      ...r,
      employee_name: r.employees?.name,
      hr_id: r.employees?.hr_id,
      // Shown, never enforced. It tells the approver whether this person had
      // signed the acknowledgement before they decide, rather than after.
      acknowledgement_on_file: r.employees?.acknowledgement_on_file,
      employees: undefined,
    })),
    settings: settings || null,
  });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === "decide") {
    const { id, status, note } = body;
    const { data, error } = await supabaseAdmin.rpc("deduction_decide", {
      p_id: id,
      p_status: status,
      p_note: note || null,
      p_by_id: staff.id || null,
      p_by_name: staff.name || "Unknown",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    try {
      await supabaseAdmin.from("activity_log").insert({
        actor_type: staff.role === "admin" ? "admin" : "employee",
        actor_id: staff.id || null,
        actor_name: staff.name || "Unknown",
        action: `deduction_${status}`,
        entity_type: "payroll_deduction",
        entity_id: id,
        details: data,
      });
    } catch (e) {
      console.error("deduction activity log failed", e);
    }
    return NextResponse.json({ ok: true, decision: data });
  }

  // Running the detectors produces pending rows only. It is safe to run at
  // any time and is a no-op until a go-live date is set.
  if (action === "detect") {
    const [visa, stock, leave, reversed] = await Promise.all([
      supabaseAdmin.rpc("detect_visa_deductions"),
      supabaseAdmin.rpc("detect_stock_deductions", { p_since: null }),
      supabaseAdmin.rpc("detect_leave_deductions"),
      supabaseAdmin.rpc("reverse_confirmed_visa_deductions"),
    ]);
    return NextResponse.json({
      ok: true,
      visa: visa.data?.[0] || visa.data,
      stock: stock.data?.[0] || stock.data,
      leave: leave.data?.[0] || leave.data,
      reversed: reversed.data ?? 0,
    });
  }

  // Turning the whole engine on. Admin only: setting a go-live date is what
  // makes every detector start producing real liabilities against real people.
  if (action === "settings") {
    if (staff.role !== "admin") {
      return NextResponse.json(
        { error: "Only an admin can change when deductions start applying." },
        { status: 403 }
      );
    }
    const patch = {};
    for (const k of ["deduction_go_live", "visa_grace_hours", "penalty_cap_percent", "dispute_window_hours"]) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        patch[k] = body[k] === "" ? null : body[k];
      }
    }
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();
    patch.updated_by_name = staff.name || "Unknown";

    const { error } = await supabaseAdmin.from("payroll_settings").update(patch).eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    try {
      await supabaseAdmin.from("activity_log").insert({
        actor_type: "admin",
        actor_id: staff.id || null,
        actor_name: staff.name || "Unknown",
        action: "deduction_settings_changed",
        entity_type: "payroll_settings",
        details: patch,
      });
    } catch (e) {
      console.error("settings activity log failed", e);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
