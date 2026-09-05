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

  const { data: employee } = await supabaseAdmin.from("employees").select("id, name, hr_id, role, fixed_salary, variable_salary, permissions, staff_account_email, must_change_password").eq("id", session.id).single();
  const { data: payslips } = await supabaseAdmin
    .from("payroll_runs")
    .select("*")
    .eq("employee_id", session.id)
    .order("generated_at", { ascending: false })
    .limit(6);
  const { data: events } = await supabaseAdmin
    .from("timeclock_events")
    .select("*")
    .eq("employee_id", session.id)
    .order("event_time", { ascending: false })
    .limit(10);
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

  return NextResponse.json({
    employee,
    payslips: payslips || [],
    events: events || [],
    leaveRequests: leaveRequests || [],
    schedule: schedule || [],
    excuseRules: excuseRules || [],
    excuseSubmissions: excuseSubmissions || [],
    incomingTransfers: incomingTransfers || [],
    mustChangePassword: session.impersonated ? false : !!employee?.must_change_password,
    impersonatedBy: session.impersonatedBy || null,
  });
}
