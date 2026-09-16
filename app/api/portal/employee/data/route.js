import { NextResponse } from "next/server";
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

  const { data: employee } = await supabaseAdmin.from("employees").select("id, name, hr_id, role, fixed_salary, variable_salary, hourly_rate, permissions, staff_account_email, must_change_password").eq("id", session.id).single();
  const { data: payslips } = await supabaseAdmin
    .from("payroll_runs")
    .select("*")
    .eq("employee_id", session.id)
    .order("generated_at", { ascending: false })
    .limit(6);
  // The whole of the current pay period, not the last ten events. Ten events
  // is five days of signing in and out, so on the 16th Nourhan could see
  // nothing before the 11th and reasonably concluded her attendance was only
  // being counted from the 10th. Her pay was right - all fourteen days were
  // counted - but she had no way to see that, and an employee who cannot check
  // their own attendance has to take payroll on trust.
  const periodStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const { data: events } = await supabaseAdmin
    .from("timeclock_events")
    .select("*")
    .eq("employee_id", session.id)
    .gte("event_time", periodStart)
    .order("event_time", { ascending: false })
    .limit(400);

  // A day-by-day account of the month: every day they were scheduled, whether
  // they signed in and out, and so which days their pay is built from. This is
  // the thing that answers "why does it say ten days" without anybody having
  // to ask.
  const { data: scheduled } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("work_date, is_day_off")
    .eq("employee_id", session.id)
    .gte("work_date", periodStart)
    .order("work_date");

  const dayIn = new Set();
  const dayOut = new Set();
  for (const ev of events || []) {
    const d = String(ev.event_time).slice(0, 10);
    if (ev.event_type === "login") dayIn.add(d);
    if (ev.event_type === "logout") dayOut.add(d);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const attendanceDays = (scheduled || [])
    .filter((d) => !d.is_day_off && d.work_date <= todayIso)
    .map((d) => ({
      date: d.work_date,
      signed_in: dayIn.has(d.work_date),
      signed_out: dayOut.has(d.work_date),
      // A day only counts once both halves are there, which is the rule pay is
      // calculated on - so it is the rule shown here too.
      counted: dayIn.has(d.work_date) && dayOut.has(d.work_date),
    }));
  const { data: leaveRequests } = await supabaseAdmin
    .from("leave_requests")
    .select("*")
    .eq("employee_id", session.id)
    .order("created_at", { ascending: false });
  const { data: excuseRules } = await supabaseAdmin.from("excuse_rules").select("id, name").order("name");
  const { data: excuseSubmissions } = await supabaseAdmin
    .from("excuse_submissions")
    .select("*, excuse_rules(name)")
    .eq("employee_id", session.id)
    .order("created_at", { ascending: false });
  const { data: incomingTransfers } = await supabaseAdmin
    .from("expense_transactions")
    .select("*, from_employee:from_employee_id(name)")
    .eq("to_employee_id", session.id)
    .eq("type", "cash_transfer")
    .order("created_at", { ascending: false });

  const today = new Date().toISOString().slice(0, 10);
  const { data: schedule } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("*")
    .eq("employee_id", session.id)
    .gte("work_date", today)
    .order("work_date", { ascending: true })
    .limit(45);

  // Checked fresh here, not read from the session token - see the identical
  // note in the client data route for why.
  // Impersonating admins are exempt: they are inspecting the account, not
  // using it, and cannot set someone else's password.
  if (!session.impersonated && employee?.must_change_password) return passwordChangeRequired();

  // A29: an employee sees their own cash and tab position, and nobody
  // else's. Both are scoped to this session's employee id.
  const [{ data: myCash }, { data: myTab }, { data: myCapacity }] = await Promise.all([
    supabaseAdmin.from("employee_cash_balances").select("brand, balance").eq("employee_id", session.id),
    supabaseAdmin.from("employee_tab_balances").select("balance").eq("employee_id", session.id).maybeSingle(),
    supabaseAdmin.rpc("employee_spend_capacity", { p_employee_id: session.id }),
  ]);

  // Their own cash movements, so the balance above is explainable without
  // asking an admin to open the dashboard. Scoped to this employee on every
  // side of a transaction - money they took, handed over, or received.
  const { data: myMovements } = await supabaseAdmin
    .from("expense_transactions")
    .select("id, brand, type, amount, payment_method, note, status, entry_date, created_at, from_employee_id, to_employee_id, employee_id")
    .or(`employee_id.eq.${session.id},from_employee_id.eq.${session.id},to_employee_id.eq.${session.id}`)
    .in("type", ["cash_transfer", "cash_collection", "cash_out", "cash_conversion"])
    .order("created_at", { ascending: false })
    .limit(30);

  // What this person has earned so far this month, from their own shifts and
  // their own sign-ins. The portal only ever showed fixed_salary, so the five
  // staff paid by the hour saw zero - their pay is all in hours worked, which
  // that field never carries. Scoped to the signed-in employee: the trial run
  // returns every employee, so their row is picked out here and the rest is
  // never sent to the browser.
  let accrued = null;
  const accruedPeriod = new Date().toISOString().slice(0, 7);
  try {
    const { data: trialRows } = await supabaseAdmin.rpc("payroll_trial_run", { p_period: accruedPeriod });
    accrued = (trialRows || []).find((r) => r.employee_id === session.id) || null;
  } catch { /* the portal is still worth serving without it */ }

  return NextResponse.json({
    accrued,
    accruedPeriod,
    employee,
    cashBalances: myCash || [],
    cashMovements: myMovements || [],
    tabBalance: Number(myTab?.balance || 0),
    spendCapacity: myCapacity || null,
    payslips: payslips || [],
    events: events || [],
    attendanceDays,
    leaveRequests: leaveRequests || [],
    schedule: schedule || [],
    excuseRules: excuseRules || [],
    excuseSubmissions: excuseSubmissions || [],
    incomingTransfers: incomingTransfers || [],
    mustChangePassword: session.impersonated ? false : !!employee?.must_change_password,
    impersonatedBy: session.impersonatedBy || null,
  });
}
