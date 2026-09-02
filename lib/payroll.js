import { supabaseAdmin } from "./supabaseAdmin";

// How a day of pay is valued, which every day_multiplier rule depends on.
//
// Hourly staff are paid their SCHEDULED hours once attendance is confirmed, not
// the clock difference: a shift that ends ten minutes early is still a day's
// work, and paying to the minute would turn every early finish into a pay cut.
// Monthly staff use salary / 30, the ordinary Egyptian convention.
export function dayValue(employee, scheduledHours) {
  const hourly = Number(employee.hourly_rate || 0);
  if (hourly > 0) return hourly * (scheduledHours || 8);
  const monthly = Number(employee.fixed_salary || 0) + Number(employee.variable_salary || 0);
  return monthly / 30;
}

export function hoursBetween(start, end) {
  if (!start || !end) return 8;
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // a shift crossing midnight
  return mins / 60;
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

// Builds one employee's payslip for a month. period is "YYYY-MM".
export async function buildPayslip(employeeId, period) {
  const { data: emp } = await supabaseAdmin
    .from("employees")
    .select("id, name, hr_id, fixed_salary, variable_salary, hourly_rate")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return null;

  const [y, m] = period.split("-").map(Number);
  const from = `${period}-01`;
  const to = new Date(y, m, 0).toISOString().slice(0, 10);
  const isHourly = Number(emp.hourly_rate || 0) > 0;

  const { data: scheduled } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("work_date, start_time, end_time, is_day_off")
    .eq("employee_id", employeeId)
    .gte("work_date", from)
    .lte("work_date", to);

  const { data: events } = await supabaseAdmin
    .from("timeclock_events")
    .select("event_type, event_time")
    .eq("employee_id", employeeId)
    .gte("event_time", from)
    .lte("event_time", `${to}T23:59:59`);

  // A day counts as worked when there is a sign-in on it. Sign-in with no
  // sign-out is NOT decided here - it is raised for an admin instead.
  const byDay = {};
  for (const e of events || []) {
    const d = String(e.event_time).slice(0, 10);
    byDay[d] = byDay[d] || { in: false, out: false };
    if (e.event_type === "login") byDay[d].in = true;
    if (e.event_type === "logout") byDay[d].out = true;
  }

  const workDays = (scheduled || []).filter((d) => !d.is_day_off);
  const days = [];
  let paidHours = 0;
  let paidDays = 0;

  for (const d of workDays) {
    const hrs = hoursBetween(d.start_time, d.end_time);
    const rec = byDay[d.work_date];
    let status = "absent";
    if (rec?.in && rec?.out) status = "worked";
    else if (rec?.in && !rec.out) status = "needs_review";

    if (status === "worked") {
      paidHours += hrs;
      paidDays += 1;
    }
    days.push({ date: d.work_date, hours: hrs, status });
  }

  const { data: adjustments } = await supabaseAdmin
    .from("payroll_adjustments")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("period", period);

  const deductions = (adjustments || []).filter((a) => a.kind === "deduction");
  const bonuses = (adjustments || []).filter((a) => a.kind === "bonus");
  const totalDeductions = deductions.reduce((s, a) => s + Number(a.amount), 0);
  const totalBonuses = bonuses.reduce((s, a) => s + Number(a.amount), 0);

  // Hourly staff earn only the days attendance confirms. Monthly staff earn
  // their salary regardless; an unworked day reaches them as a deduction rule,
  // not by shrinking the base, which is what makes a monthly payslip readable.
  const basePay = isHourly
    ? paidHours * Number(emp.hourly_rate)
    : Number(emp.fixed_salary || 0) + Number(emp.variable_salary || 0);

  return {
    employee: emp,
    period,
    payBasis: isHourly ? "hourly" : "monthly",
    hourlyRate: Number(emp.hourly_rate || 0),
    scheduledDays: workDays.length,
    paidDays,
    paidHours,
    needsReview: days.filter((d) => d.status === "needs_review").length,
    absentDays: days.filter((d) => d.status === "absent").length,
    days,
    basePay,
    bonuses,
    deductions,
    totalBonuses,
    totalDeductions,
    net: basePay + totalBonuses - totalDeductions,
  };
}
