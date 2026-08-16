import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "employee") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { startDate, endDate, reason } = await req.json();
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "Start date and end date are required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("leave_requests")
    .insert({ employee_id: session.id, start_date: startDate, end_date: endDate, reason, status: "pending" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}
