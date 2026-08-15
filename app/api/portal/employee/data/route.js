import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "employee") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: employee } = await supabaseAdmin.from("employees").select("id, name, hr_id, role").eq("id", session.id).single();
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

  return NextResponse.json({ employee, payslips: payslips || [], events: events || [] });
}
