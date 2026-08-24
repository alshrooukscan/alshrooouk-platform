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

  const { excuseRuleId, note } = await req.json();
  if (!excuseRuleId) {
    return NextResponse.json({ error: "Excuse type is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("excuse_submissions")
    .insert({ employee_id: session.id, excuse_rule_id: excuseRuleId, note, status: "pending" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ submission: data });
}
