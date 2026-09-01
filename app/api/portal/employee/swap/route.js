import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// Shift swaps are a straight two-row exchange between existing rows in
// employee_schedule_days: on acceptance the employee_id is swapped between
// the requester's day and the colleague's day. Modelling it that way (rather
// than copying times around) means a swap can never leave one person with two
// rows on the same date, and it works identically whether the two are trading
// different dates or two shifts on the same day.

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// GET - everything the Swaps tab needs in one call: my outgoing requests,
// requests waiting on me, my own upcoming days, and colleagues with theirs.
export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayISO();

  const { data: myDays } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("id, work_date, start_time, end_time, is_day_off")
    .eq("employee_id", session.id)
    .gte("work_date", today)
    .order("work_date", { ascending: true })
    .limit(60);

  const { data: colleagues } = await supabaseAdmin
    .from("employees")
    .select("id, name")
    .eq("is_active", true)
    .neq("id", session.id)
    .order("name");

  const colleagueIds = (colleagues || []).map((c) => c.id);
  let colleagueDays = [];
  if (colleagueIds.length) {
    const { data } = await supabaseAdmin
      .from("employee_schedule_days")
      .select("id, employee_id, work_date, start_time, end_time, is_day_off")
      .in("employee_id", colleagueIds)
      .gte("work_date", today)
      .order("work_date", { ascending: true })
      .limit(1500);
    colleagueDays = data || [];
  }

  const { data: outgoing } = await supabaseAdmin
    .from("shift_swap_requests")
    .select("*, target:target_id(name), requester_day:requester_day_id(work_date, start_time, end_time, is_day_off), target_day:target_day_id(work_date, start_time, end_time, is_day_off)")
    .eq("requester_id", session.id)
    .order("created_at", { ascending: false })
    .limit(40);

  const { data: incoming } = await supabaseAdmin
    .from("shift_swap_requests")
    .select("*, requester:requester_id(name), requester_day:requester_day_id(work_date, start_time, end_time, is_day_off), target_day:target_day_id(work_date, start_time, end_time, is_day_off)")
    .eq("target_id", session.id)
    .order("created_at", { ascending: false })
    .limit(40);

  return NextResponse.json({
    myDays: myDays || [],
    colleagues: colleagues || [],
    colleagueDays,
    outgoing: outgoing || [],
    incoming: incoming || [],
  });
}

// POST - propose a swap. Validates ownership of both sides so an employee can
// only ever offer a day that is genuinely theirs, and only ever ask for a day
// that genuinely belongs to the colleague they named.
export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requesterDayId, targetId, targetDayId, note } = await req.json();
  if (!requesterDayId || !targetId || !targetDayId) {
    return NextResponse.json(
      { error: "Pick one of your own days, a colleague, and one of their days." },
      { status: 400 }
    );
  }
  if (targetId === session.id) {
    return NextResponse.json({ error: "You can't swap a shift with yourself." }, { status: 400 });
  }

  const { data: myDay } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("id, employee_id, work_date")
    .eq("id", requesterDayId)
    .maybeSingle();
  if (!myDay || myDay.employee_id !== session.id) {
    return NextResponse.json({ error: "That day isn't on your schedule." }, { status: 400 });
  }

  const { data: theirDay } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("id, employee_id, work_date")
    .eq("id", targetDayId)
    .maybeSingle();
  if (!theirDay || theirDay.employee_id !== targetId) {
    return NextResponse.json({ error: "That day isn't on your colleague's schedule." }, { status: 400 });
  }

  const today = todayISO();
  if (myDay.work_date < today || theirDay.work_date < today) {
    return NextResponse.json({ error: "You can only swap upcoming days, not past ones." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("shift_swap_requests")
    .insert({
      requester_id: session.id,
      requester_day_id: requesterDayId,
      target_id: targetId,
      target_day_id: targetDayId,
      note: note || null,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    // The partial unique index makes a duplicate pending request on the same
    // pair of days a constraint violation rather than a silent second row.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You've already got a pending request for these two days." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ request: data });
}
