import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";
import { buildPayslip, resolveRuleAmount, hoursBetween } from "../../../../lib/payroll";

function canHr(staff) {
  return staff && (staff.role === "admin" || staff.permissions?.hr === true);
}

// GET ?rules=1                     -> deduction and bonus rules
// GET ?payslip=<employeeId>&period -> one payslip
// GET ?exceptions=1                -> attendance days needing an admin decision
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });

  const url = new URL(req.url);

  if (url.searchParams.get("rules")) {
    const { data } = await supabaseAdmin
      .from("deduction_rules")
      .select("*")
      .order("kind")
      .order("name");
    return NextResponse.json({ rules: data || [] });
  }

  if (url.searchParams.get("exceptions")) {
    const { data } = await supabaseAdmin
      .from("attendance_exceptions")
      .select("*, employees(name, hourly_rate)")
      .eq("status", "pending")
      .order("work_date");
    return NextResponse.json({ exceptions: data || [] });
  }

  const empId = url.searchParams.get("payslip");
  if (empId) {
    const period = url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
    const slip = await buildPayslip(empId, period);
    if (!slip) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    return NextResponse.json({ payslip: slip });
  }

  return NextResponse.json({ error: "Nothing requested." }, { status: 400 });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!canHr(staff)) return NextResponse.json({ error: "HR access required." }, { status: 403 });

  const body = await req.json();
  const { action } = body;

  if (action === "save_rule") {
    const { id, name, kind, ruleType, value, description } = body;
    if (!name || !ruleType || value === undefined) {
      return NextResponse.json({ error: "Name, type and value are required." }, { status: 400 });
    }
    if (Number(value) <= 0) return NextResponse.json({ error: "Value must be greater than zero." }, { status: 400 });

    const row = {
      name,
      kind: kind === "bonus" ? "bonus" : "deduction",
      rule_type: ruleType,
      value: Number(value),
      description: description || null,
      updated_at: new Date().toISOString(),
    };
    if (id) {
      const { error } = await supabaseAdmin.from("deduction_rules").update(row).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, id });
    }
    const { data, error } = await supabaseAdmin.from("deduction_rules").insert(row).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "retire_rule") {
    // Deactivated, not deleted. Amounts already applied reference this rule, and
    // an old payslip must still be able to say where its figure came from.
    const { id, active } = body;
    const { error } = await supabaseAdmin.from("deduction_rules").update({ is_active: active !== false }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_rule") {
    const { id } = body;
    const { count } = await supabaseAdmin
      .from("payroll_adjustments")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", id);
    if (count && count > 0) {
      return NextResponse.json(
        { error: `This rule has been applied ${count} time${count === 1 ? "" : "s"} and can't be deleted. Deactivate it instead so past payslips still make sense.` },
        { status: 409 }
      );
    }
    const { error } = await supabaseAdmin.from("deduction_rules").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "apply") {
    const { employeeId, ruleId, period, note, occurredOn, amountOverride } = body;
    if (!employeeId || !period) {
      return NextResponse.json({ error: "Employee and period are required." }, { status: 400 });
    }

    const { data: emp } = await supabaseAdmin
      .from("employees")
      .select("id, fixed_salary, variable_salary, hourly_rate")
      .eq("id", employeeId)
      .maybeSingle();
    if (!emp) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

    const { data: rule } = ruleId
      ? await supabaseAdmin.from("deduction_rules").select("*").eq("id", ruleId).maybeSingle()
      : { data: null };

    // The scheduled hours of the day it happened decide what "a day" is worth
    // for that person, so an eight-hour day and a six-hour day are not charged
    // the same.
    let scheduledHours = 8;
    if (occurredOn) {
      const { data: day } = await supabaseAdmin
        .from("employee_schedule_days")
        .select("start_time, end_time")
        .eq("employee_id", employeeId)
        .eq("work_date", occurredOn)
        .maybeSingle();
      if (day) scheduledHours = hoursBetween(day.start_time, day.end_time);
    }

    const amount = amountOverride !== undefined && amountOverride !== null && amountOverride !== ""
      ? Number(amountOverride)
      : rule
      ? resolveRuleAmount(rule, emp, scheduledHours)
      : 0;

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "That works out to zero — pick a rule or enter an amount." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("payroll_adjustments").insert({
      employee_id: employeeId,
      rule_id: rule?.id || null,
      period,
      kind: rule?.kind || (body.kind === "bonus" ? "bonus" : "deduction"),
      label: rule?.name || body.label || "Manual adjustment",
      amount: Math.round(amount * 100) / 100,
      note: note || null,
      occurred_on: occurredOn || null,
      created_by_id: staff.id,
      created_by_name: staff.name,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, amount: Math.round(amount * 100) / 100 });
  }

  if (action === "remove_adjustment") {
    const { id } = body;
    const { error } = await supabaseAdmin.from("payroll_adjustments").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "decide_exception") {
    if (staff.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can decide an attendance exception." }, { status: 403 });
    }
    const { id, approve, hours } = body;
    const { data: exc } = await supabaseAdmin.from("attendance_exceptions").select("*").eq("id", id).maybeSingle();
    if (!exc) return NextResponse.json({ error: "That exception no longer exists." }, { status: 404 });
    if (exc.status !== "pending") {
      return NextResponse.json({ error: `Already ${exc.status}.` }, { status: 409 });
    }

    // Approving credits the day by writing the missing sign-out, so the payslip
    // recalculates from real attendance rather than carrying a special case.
    if (approve) {
      const { data: day } = await supabaseAdmin
        .from("employee_schedule_days")
        .select("end_time")
        .eq("employee_id", exc.employee_id)
        .eq("work_date", exc.work_date)
        .maybeSingle();
      const endTime = day?.end_time || "17:00";
      await supabaseAdmin.from("timeclock_events").insert({
        employee_id: exc.employee_id,
        event_type: "logout",
        event_time: `${exc.work_date}T${endTime}`,
        face_match_status: "manual_entry",
        correction_note: `Missing sign-out credited by ${staff.name} on ${new Date().toISOString().slice(0, 10)}`,
      });
    }

    await supabaseAdmin
      .from("attendance_exceptions")
      .update({
        status: approve ? "approved" : "rejected",
        hours_credited: approve ? hours || null : null,
        reviewed_by_name: staff.name,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
