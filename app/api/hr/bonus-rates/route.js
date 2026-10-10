import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";
import { normalizePeriod } from "../../../../lib/payroll";

// v3 bonus rates and attendance balance (client voice notes, 5 and 6 Oct 2026).
//
// Scan types carry the defaults: whether a report counts toward the daily
// baseline, whether it is a standalone bonus (Dental Photography), and the
// default report and raw data rates. Each employee can override any rate.
// Everything here is HR-guarded and runs with the service role, like the
// rest of payroll.

function canHr(staff) {
  return staff && (staff.role === "admin" || staff.permissions?.hr === true);
}

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// GET ?settings=1                    -> payroll settings incl. v3 attendance rules
// GET ?types=1                       -> every scan type with its bonus settings
// GET ?employee=<id>                 -> rate table for one employee (defaults + overrides)
// GET ?lines=<id>&period=YYYY-MM     -> every bonus line behind a payslip
// GET ?balance=<id>&period=YYYY-MM   -> monthly attendance balance
// GET ?days=<id>&period=YYYY-MM      -> day-by-day attendance
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });
  const url = new URL(req.url);

  if (url.searchParams.get("settings")) {
    const { data, error } = await supabaseAdmin.from("payroll_settings").select("*").eq("id", true).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ settings: data });
  }

  if (url.searchParams.get("types")) {
    const { data, error } = await supabaseAdmin
      .from("exam_types")
      .select("id, name, category, is_active, counts_in_report_baseline, standalone_bonus, default_report_bonus, default_raw_bonus")
      .order("category")
      .order("name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: bundles } = await supabaseAdmin
      .from("exam_type_bundle_items")
      .select("bundle_exam_type_id, component_exam_type_id, quantity");
    return NextResponse.json({ types: data || [], bundles: bundles || [] });
  }

  const empId = url.searchParams.get("employee");
  if (empId) {
    const [{ data: types, error }, { data: overrides }] = await Promise.all([
      supabaseAdmin
        .from("exam_types")
        .select("id, name, counts_in_report_baseline, standalone_bonus, default_report_bonus, default_raw_bonus")
        .or("counts_in_report_baseline.eq.true,standalone_bonus.eq.true")
        .order("name"),
      supabaseAdmin.from("employee_bonus_rates").select("*").eq("employee_id", empId),
    ]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const byType = Object.fromEntries((overrides || []).map((o) => [o.exam_type_id, o]));
    const rows = (types || []).map((t) => {
      const o = byType[t.id] || {};
      return {
        exam_type_id: t.id,
        name: t.name,
        standalone: t.standalone_bonus,
        default_report_rate: Number(t.default_report_bonus || 0),
        default_raw_rate: Number(t.default_raw_bonus || 0),
        report_rate: o.report_rate ?? null,
        raw_rate: o.raw_rate ?? null,
        updated_by_name: o.updated_by_name || null,
      };
    });
    return NextResponse.json({ rates: rows });
  }

  const period = normalizePeriod(url.searchParams.get("period"));

  const linesFor = url.searchParams.get("lines");
  if (linesFor) {
    const { data, error } = await supabaseAdmin.rpc("employee_bonus_lines", { p_employee_id: linesFor, p_period: period });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ period, lines: data || [] });
  }

  const balanceFor = url.searchParams.get("balance");
  if (balanceFor) {
    const { data, error } = await supabaseAdmin.rpc("attendance_balance", { p_employee_id: balanceFor, p_period: period });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ period, balance: data });
  }

  const daysFor = url.searchParams.get("days");
  if (daysFor) {
    const from = `${period}-01`;
    const to = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin.rpc("attendance_days", { p_employee_id: daysFor, p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ period, days: data || [] });
  }

  return NextResponse.json({ error: "Nothing requested." }, { status: 400 });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });
  const body = await req.json();

  // Defaults for a scan type change what everyone without an override earns,
  // so only an admin may change them.
  if (body.action === "save_type") {
    if (staff.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can change the default bonus rates." }, { status: 403 });
    }
    const rep = num(body.defaultReportBonus);
    const raw = num(body.defaultRawBonus);
    if (Number.isNaN(rep) || Number.isNaN(raw)) {
      return NextResponse.json({ error: "Rates must be zero or more." }, { status: 400 });
    }
    const patch = {
      counts_in_report_baseline: !!body.countsInBaseline,
      standalone_bonus: !!body.standalone,
      default_report_bonus: rep ?? 0,
      default_raw_bonus: raw ?? 0,
    };
    const { error } = await supabaseAdmin.from("exam_types").update(patch).eq("id", body.examTypeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await log(staff, "bonus_type_changed", "exam_type", body.examTypeId, patch);
    return NextResponse.json({ ok: true });
  }

  // A blank rate means "use the default", so clearing both removes the override.
  if (body.action === "save_employee_rate") {
    const rep = num(body.reportRate);
    const raw = num(body.rawRate);
    if (Number.isNaN(rep) || Number.isNaN(raw)) {
      return NextResponse.json({ error: "Rates must be zero or more, or left blank for the default." }, { status: 400 });
    }
    if (!body.employeeId || !body.examTypeId) {
      return NextResponse.json({ error: "Employee and scan type are required." }, { status: 400 });
    }
    if (rep === null && raw === null) {
      const { error } = await supabaseAdmin
        .from("employee_bonus_rates")
        .delete()
        .eq("employee_id", body.employeeId)
        .eq("exam_type_id", body.examTypeId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    } else {
      const { error } = await supabaseAdmin.from("employee_bonus_rates").upsert(
        {
          employee_id: body.employeeId,
          exam_type_id: body.examTypeId,
          report_rate: rep,
          raw_rate: raw,
          updated_by_name: staff.name || "Unknown",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "employee_id,exam_type_id" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
    await log(staff, "employee_bonus_rate_changed", "employee", body.employeeId, {
      exam_type_id: body.examTypeId,
      report_rate: rep,
      raw_rate: raw,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

// Logging must never block payroll.
async function log(staff, action, entityType, entityId, details) {
  try {
    await supabaseAdmin.from("activity_log").insert({
      actor_type: staff.role === "admin" ? "admin" : "employee",
      actor_id: staff.id || null,
      actor_name: staff.name || "Unknown",
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details,
    });
  } catch (e) {
    console.error("bonus-rates activity log failed", e);
  }
}
