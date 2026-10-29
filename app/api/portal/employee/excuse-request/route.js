import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { excuseRuleId, excuseDate, note } = await req.json();
  if (!excuseRuleId) {
    return NextResponse.json({ error: "Excuse type is required" }, { status: 400 });
  }
  // The day the excuse is for (YYYY-MM-DD), not the day it was submitted.
  const validDate =
    typeof excuseDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(excuseDate) &&
    !Number.isNaN(Date.parse(`${excuseDate}T00:00:00Z`)) &&
    new Date(`${excuseDate}T00:00:00Z`).toISOString().slice(0, 10) === excuseDate;
  if (!validDate) {
    return NextResponse.json({ error: "Date of the excuse is required (YYYY-MM-DD)" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("excuse_submissions")
    .insert({ employee_id: session.id, excuse_rule_id: excuseRuleId, excuse_date: excuseDate, note, status: "pending" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ submission: data });
}
