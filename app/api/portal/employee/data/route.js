import { NextResponse } from "next/server";
import { applyEarnedToDate } from "../../../../../lib/earnedToDate";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
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
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Everything this page needs, asked for at once rather than one query after
  // another (30 Oct 2026: opening the portal took several seconds).
  const periodStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const today = new Date().toISOString().slice(0, 10);
  const accruedPeriod = new Date().toISOString().slice(0, 7);
  const [
    { data: employee }, { data: payslips }, { data: events }, { data: scheduled },
    { data: leaveRequests }, { data: excuseRules }, { data: excuseSubmissions }, { data: incomingTransfers },
    { data: schedule }, { data: myCash }, { data: myTab }, { data: myCapacity }, { data: myMovements },
    trialRes, previewRes, monthRes,
  ] = await Promise.all([
    supabaseAdmin.from("employees").select("id, name, hr_id, role, fixed_salary, variable_salary, hourly_rate, permissions, staff_account_email, must_change_password").eq("id", session.id).single(),
    supabaseAdmin.from("payroll_runs").select("*").eq("employee_id", session.id).order("generated_at", { ascending: false }).limit(6),
    // The whole of the current pay period, not the last ten events, so an
    // employee can check every day their pay is built from.
    supabaseAdmin.from("timeclock_events").select("*").eq("employee_id", session.id).gte("event_time", periodStart).order("event_time", { ascending: false }).limit(400),
    supabaseAdmin.from("employee_schedule_days").select("work_date, is_day_off").eq("employee_id", session.id).gte("work_date", periodStart).order("work_date"),
    supabaseAdmin.from("leave_requests").select("*").eq("employee_id", session.id).order("created_at", { ascending: false }),
    supabaseAdmin.from("excuse_rules").select("id, name").order("name"),
    supabaseAdmin.from("excuse_submissions").select("*, excuse_rules(name)").eq("employee_id", session.id).order("created_at", { ascending: false }),
    supabaseAdmin.from("expense_transactions").select("*, from_employee:from_employee_id(name)").eq("to_employee_id", session.id).eq("type", "cash_transfer").order("created_at", { ascending: false }),
    supabaseAdmin.from("employee_schedule_days").select("*").eq("employee_id", session.id).gte("work_date", today).order("work_date", { ascending: true }).limit(45),
    // A29: an employee sees their own cash and tab position, and nobody else's.
    supabaseAdmin.from("employee_cash_balances").select("brand, balance").eq("employee_id", session.id),
    supabaseAdmin.from("employee_tab_balances").select("balance").eq("employee_id", session.id).maybeSingle(),
    supabaseAdmin.rpc("employee_spend_capacity", { p_employee_id: session.id }),
    // Their own cash movements, on either side of a transaction.
    supabaseAdmin
      .from("expense_transactions")
      .select("id, brand, type, amount, payment_method, note, status, entry_date, created_at, from_employee_id, to_employee_id")
      .or(`from_employee_id.eq.${session.id},to_employee_id.eq.${session.id}`)
      .in("type", ["cash_transfer", "cash_collection", "cash_out", "cash_conversion"])
      .order("created_at", { ascending: false })
      .limit(30),
    // Earned so far, for this employee only (0123): the whole-staff run took
    // 6-7 seconds to read back one row.
    supabaseAdmin.rpc("payroll_trial_run", { p_period: accruedPeriod, p_employee_id: session.id }),
    supabaseAdmin.rpc("payslip_preview", { p_employee_id: session.id, p_period: accruedPeriod }),
    supabaseAdmin.rpc("payroll_month", { p_employee_id: session.id, p_period: accruedPeriod }),
  ]);

  const dayIn = new Set();
  const dayOut = new Set();
  for (const ev of events || []) {
    const d = String(ev.event_time).slice(0, 10);
    if (ev.event_type === "login") dayIn.add(d);
    if (ev.event_type === "logout") dayOut.add(d);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  // Every scheduled day, plus any day they worked that was not on the roster.
  // Showing scheduled days alone left Doaa with an empty panel: she has signed
  // in eight times this month against a roster with nothing in it, so the one
  // view that explains her pay showed her nothing at all. A day worked is worth
  // seeing whether or not somebody put it on a roster first.
  const rosterDays = new Set(
    (scheduled || []).filter((d) => !d.is_day_off).map((d) => d.work_date)
  );
  const workedDays = new Set([...dayIn, ...dayOut]);
  const allDays = [...new Set([...rosterDays, ...workedDays])]
    .filter((d) => d <= todayIso)
    .sort();

  const attendanceDays = allDays.map((d) => ({
    date: d,
    scheduled: rosterDays.has(d),
    signed_in: dayIn.has(d),
    signed_out: dayOut.has(d),
    // A day only counts once both halves are there, which is the rule pay is
    // calculated on - so it is the rule shown here too.
    counted: dayIn.has(d) && dayOut.has(d),
  }));

  // Said plainly where it applies. A salaried person with no roster is paid the
  // whole salary because the rule - salary divided by scheduled days, times
  // days worked - has no denominator without one. They should know that is why,
  // rather than seeing a number they cannot reconcile with their own days.
  const noRoster = rosterDays.size === 0 && Number(employee?.hourly_rate || 0) === 0;
  // Checked fresh here, not read from the session token - see the identical
  // note in the client data route for why.
  // Impersonating admins are exempt: they are inspecting the account, not
  // using it, and cannot set someone else's password.
  if (!session.impersonated && employee?.must_change_password) return passwordChangeRequired();

  // What this person has earned so far this month, from their own shifts and
  // their own sign-ins. The portal only ever showed fixed_salary, so the five
  // staff paid by the hour saw zero - their pay is all in hours worked, which
  // that field never carries. Scoped to the signed-in employee: the trial run
  // returns every employee, so their row is picked out here and the rest is
  // never sent to the browser.
  // Earned so far grows day by day (2 Nov 2026), see lib/earnedToDate.js.
  const accrued = applyEarnedToDate((trialRes.data || []).find((r) => r.employee_id === session.id) || null, monthRes.data);

  // This month's payslip as it stands, with only what an admin has approved:
  // each bonus and deduction by name. Mohamed Said (30 Oct 2026): an employee
  // opening their month should see what was approved, plus or minus.
  let currentSlip = null;
  if (!(payslips || []).some((p) => String(p.period).slice(0, 7) === accruedPeriod)) {
    try {
      const pv = previewRes.data;
      if (pv) {
        const approved = (pv.adjustments || []).filter((a) => a.status === "approved");
        currentSlip = {
          period: accruedPeriod,
          pay_basis: pv.pay_basis,
          paid_hours: Number(pv.paid_hours || 0),
          base: Number(pv.gross || 0),
          report_bonus: Number(pv.report_bonus || 0),
          raw_data_bonus: Number(pv.raw_data_bonus || 0),
          bonuses: approved.filter((a) => a.kind === "bonus").map((a) => ({ name: a.label, amount: Number(a.amount) })),
          deductions: approved.filter((a) => a.kind === "deduction").map((a) => ({ name: a.label, amount: Number(a.amount), note: a.note || null })),
          deferred: Number(pv.penalty_deferred || 0),
          advance: Number(pv.open_advances || 0),
          net: Number(pv.indicative_net || 0),
          overtime_pending: !!pv.overtime_awaiting_decision,
        };
      }
    } catch { /* the portal is still worth serving without it */ }
  }

  // Perfect attendance progress for the month, shown as a goal on the portal.
  let attendanceGoal = null;
  try {
    const m = monthRes.data;
    if (m) {
      attendanceGoal = {
        perfect_attendance: !!m.perfect_attendance, perfect_attendance_bonus: Number(m.perfect_attendance_bonus || 0),
        perfect_attendance_pct: Number(m.perfect_attendance_pct || 10), late_minutes: Number(m.late_minutes || 0),
        early_leave_minutes: Number(m.early_leave_minutes || 0), absent_days: Number(m.absent_days || 0),
        present_days: Number(m.present_days || 0), scheduled_days: Number(m.scheduled_days || 0),
        future_days: Number(m.future_days || 0), month_complete: !!m.month_complete,
        attendance_exempt: !!m.attendance_exempt, base: Number(m.base || 0), scheduled_pay: Number(m.scheduled_pay || 0),
      };
    }
  } catch { /* optional */ }

  return NextResponse.json({
    accrued,
    currentSlip,
    attendanceGoal,
    accruedPeriod,
    employee,
    cashBalances: myCash || [],
    cashMovements: myMovements || [],
    tabBalance: Number(myTab?.balance || 0),
    spendCapacity: myCapacity || null,
    payslips: payslips || [],
    events: events || [],
    attendanceDays,
    noRoster,
    leaveRequests: leaveRequests || [],
    schedule: schedule || [],
    excuseRules: excuseRules || [],
    excuseSubmissions: excuseSubmissions || [],
    incomingTransfers: incomingTransfers || [],
    mustChangePassword: session.impersonated ? false : !!employee?.must_change_password,
    impersonatedBy: session.impersonatedBy || null,
  });
}
