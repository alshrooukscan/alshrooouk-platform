import { supabaseAdmin } from "./supabaseAdmin";

// ---------------------------------------------------------------------
// One payroll engine.
//
// This file used to calculate a payslip in JavaScript while the
// generate_payslip() RPC calculated a different one in SQL. The two
// disagreed by up to 78% on hourly staff, and which figure you saw
// depended on which button you pressed. Migration 0088 moved the whole
// calculation into the database. Everything here is now a thin adapter
// over payslip_preview(), so the preview and the committed payslip can
// never disagree again.
// ---------------------------------------------------------------------

// Period is YYYY-MM everywhere. The profile page used to send
// "September 2026", which matched nothing in payroll_adjustments and
// silently dropped every manual bonus and deduction.
export function normalizePeriod(period) {
  if (!period) return new Date().toISOString().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(period)) return period;
  const d = new Date(`${period} 1`);
  if (!isNaN(d)) return d.toISOString().slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

export function hoursBetween(start, end) {
  if (!start || !end) return 8;
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // a shift crossing midnight
  return mins / 60;
}

// How a day of pay is valued, which every day_multiplier rule depends on.
// Hourly staff are paid their SCHEDULED hours once attendance is confirmed,
// not the clock difference: a shift that ends ten minutes early is still a
// day's work. Monthly staff use salary / 30, the ordinary Egyptian convention.
export function dayValue(employee, scheduledHours) {
  const hourly = Number(employee.hourly_rate || 0);
  if (hourly > 0) return hourly * (scheduledHours || 8);
  const monthly = Number(employee.fixed_salary || 0) + Number(employee.variable_salary || 0);
  return monthly / 30;
}

// Turns a rule into an amount for one person. Resolved at the moment it is
// applied and then frozen, so editing the rule later cannot rewrite a payslip
// that has already been issued.
export function resolveRuleAmount(rule, employee, scheduledHours) {
  const value = Number(rule.value || 0);
  if (rule.rule_type === "fixed") return value;
  if (rule.rule_type === "day_multiplier") return dayValue(employee, scheduledHours) * value;
  if (rule.rule_type === "percentage") {
    const monthly = Number(employee.fixed_salary || 0) + Number(employee.variable_salary || 0);
    return (monthly * value) / 100;
  }
  return 0;
}

// Reads the one calculation in the database and shapes it for the existing
// Payslips screen. Nothing is computed here.
export async function buildPayslip(employeeId, period) {
  const p = normalizePeriod(period);

  const { data: emp } = await supabaseAdmin
    .from("employees")
    .select("id, name, hr_id, fixed_salary, variable_salary, hourly_rate")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return null;

  const { data: preview, error } = await supabaseAdmin
    .rpc("payslip_preview", { p_employee_id: employeeId, p_period: p });
  if (error || !preview || preview.error) return null;

  const att = preview.attendance || {};

  // Line items, in the order payroll applies them (decision A38).
  const { data: adjustments } = await supabaseAdmin
    .from("payroll_adjustments")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("period", p);

  const manualDeductions = (adjustments || []).filter((a) => a.kind === "deduction");
  const bonuses = (adjustments || []).filter((a) => a.kind === "bonus");

  const settlementLines = [];
  if (Number(preview.advances) > 0)
    settlementLines.push({ id: "adv", label: "Advance repayment", amount: Number(preview.advances), note: null });
  if (Number(preview.tab_deduction) > 0)
    settlementLines.push({
      id: "tab", label: "Staff F&B tab", amount: Number(preview.tab_deduction),
      note: Number(preview.tab_balance) > Number(preview.tab_deduction)
        ? `${(Number(preview.tab_balance) - Number(preview.tab_deduction)).toFixed(2)} carried forward` : null,
    });
  if (Number(preview.cash_sweep) > 0)
    settlementLines.push({ id: "cash", label: "Unsettled cash held", amount: Number(preview.cash_sweep), note: "Settled at payroll" });

  const ruleLines = (preview.rule_lines || []).map((l, i) => ({
    id: `rule-${i}`, label: l.name, amount: Number(l.amount), note: null,
  }));

  return {
    employee: emp,
    period: p,
    payBasis: preview.pay_basis,
    hourlyRate: Number(preview.hourly_rate || 0),
    scheduledDays: att.scheduled_days || 0,
    paidDays: att.paid_days || 0,
    paidHours: Number(att.paid_hours || 0),
    needsReview: att.needs_review || 0,
    absentDays: att.absent_days || 0,
    days: att.days || [],
    basePay: Number(preview.gross || 0),
    bonuses,
    deductions: [...ruleLines, ...manualDeductions, ...settlementLines],
    totalBonuses: Number(preview.bonuses || 0),
    totalDeductions: Number(preview.total_deductions || 0),
    cashExempt: Number(preview.cash_exempt || 0),
    alreadyIssued: !!preview.already_issued,
    net: Number(preview.net || 0),
  };
}
