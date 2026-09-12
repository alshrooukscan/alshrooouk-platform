import { supabaseAdmin } from "./supabaseAdmin";

// ONE payroll engine.
//
// Everything that decides a figure now lives in the database, in
// payslip_hours / payslip_gross_v2 / payslip_preview / generate_payslip.
// This file used to compute a second, slightly different answer in
// JavaScript, which meant an hourly employee had two different salaries
// depending on which screen was open. Those numbers are no longer
// calculated here; they are read from the same function that commits them.

export function hoursBetween(start, end) {
  if (!start || !end) return 8;
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // a shift crossing midnight
  return mins / 60;
}

// Every path normalises its period the same way the database does, so a
// bonus filed against "2026-09" is never invisible to a payslip generated
// as "September 2026".
export function normalizePeriod(period) {
  if (!period) return new Date().toISOString().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(String(period))) return String(period);
  const d = new Date(`${period} 1`);
  if (!isNaN(d)) return d.toISOString().slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

// How a day of pay is valued, which every day_multiplier rule depends on.
export function dayValue(employee, scheduledHours) {
  const hourly = Number(employee.hourly_rate || 0);
  if (hourly > 0) return hourly * (scheduledHours || 8);
  const monthly = Number(employee.fixed_salary || 0) + Number(employee.variable_salary || 0);
  return monthly / 30;
}

// Turns a rule into an amount for one person. Resolved at the moment it is
// applied and then frozen, so editing the rule later cannot rewrite a
// payslip that has already been issued.
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

// Read-only preview. Identical figures to what generate_payslip commits,
// because it is the same function.
export async function buildPayslip(employeeId, period) {
  const p = normalizePeriod(period);
  const { data, error } = await supabaseAdmin.rpc("payslip_preview", {
    p_employee_id: employeeId,
    p_period: p,
  });
  if (error || !data) return null;

  const adjustments = data.adjustments || [];
  const deductions = adjustments.filter((a) => a.kind === "deduction");
  const bonuses = adjustments.filter((a) => a.kind === "bonus");

  // Shape kept identical to what the Payslips page already renders.
  return {
    employee: data.employee,
    period: data.period,
    payBasis: data.pay_basis,
    hourlyRate: Number(data.employee?.hourly_rate || 0),
    scheduledDays: Number(data.paid_days || 0) + Number(data.needs_review || 0) + Number(data.absent_days || 0),
    paidDays: Number(data.paid_days || 0),
    paidHours: Number(data.paid_hours || 0),
    needsReview: Number(data.needs_review || 0),
    absentDays: Number(data.absent_days || 0),
    unscheduledDays: Number(data.unscheduled_days || 0),
    unscheduledHours: Number(data.unscheduled_hours_paid || 0),
    overtimePendingHours: Number(data.overtime_pending_hours || 0),
    overtimePendingValue: Number(data.overtime_pending_value || 0),
    days: [],
    basePay: Number(data.gross || 0),
    bonuses,
    deductions,
    totalBonuses: Number(data.total_bonuses || 0),
    totalDeductions: Number(data.total_adjustment_deductions || 0),
    ruleDeductions: Number(data.total_rule_deductions || 0),
    openAdvances: Number(data.open_advances || 0),
    tabBalance: Number(data.tab_balance || 0),
    settlement: data.settlement || null,
    alreadyGenerated: !!data.already_generated,
    net: Number(data.indicative_net || 0),
  };
}
