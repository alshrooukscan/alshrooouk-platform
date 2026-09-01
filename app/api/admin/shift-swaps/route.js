import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";

// HR sign-off on a swap both employees already agreed to. This is the only
// place the published roster is actually rewritten: acceptance by the
// colleague parks the request at awaiting_admin, and approval here trades
// employee_id between the two schedule rows.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Staff access required" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("shift_swap_requests")
    .select("*, requester:requester_id(name, hr_id), target:target_id(name, hr_id), requester_day:requester_day_id(work_date, start_time, end_time, is_day_off), target_day:target_day_id(work_date, start_time, end_time, is_day_off)")
    .eq("status", "awaiting_admin")
    .order("accepted_at", { ascending: true });

  return NextResponse.json({ requests: data || [] });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Staff access required" }, { status: 401 });
  if (staff.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can approve shift swaps." }, { status: 403 });
  }

  const { requestId, action, note } = await req.json();
  if (!requestId || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "requestId and a valid action are required" }, { status: 400 });
  }

  const { data: swap } = await supabaseAdmin
    .from("shift_swap_requests")
    .select("*, requester:requester_id(name), target:target_id(name)")
    .eq("id", requestId)
    .maybeSingle();

  if (!swap) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  if (swap.status !== "awaiting_admin") {
    return NextResponse.json({ error: `This request is ${swap.status}, not awaiting approval.` }, { status: 409 });
  }

  if (action === "reject") {
    await supabaseAdmin
      .from("shift_swap_requests")
      .update({
        status: "rejected",
        approved_by_id: staff.id,
        approved_by_name: staff.name,
        decision_note: note || null,
        responded_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "awaiting_admin");
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Re-read both rows at approval time. HR may have rebuilt the roster while
  // this sat in the queue, in which case applying it would move the wrong day.
  const { data: reqDay } = await supabaseAdmin
    .from("employee_schedule_days").select("id, employee_id, work_date")
    .eq("id", swap.requester_day_id).maybeSingle();
  const { data: tgtDay } = await supabaseAdmin
    .from("employee_schedule_days").select("id, employee_id, work_date")
    .eq("id", swap.target_day_id).maybeSingle();

  if (!reqDay || !tgtDay || reqDay.employee_id !== swap.requester_id || tgtDay.employee_id !== swap.target_id) {
    await supabaseAdmin
      .from("shift_swap_requests")
      .update({ status: "cancelled", approved_by_id: staff.id, approved_by_name: staff.name,
                decision_note: "Schedule changed before approval", responded_at: new Date().toISOString() })
      .eq("id", requestId);
    return NextResponse.json(
      { error: "The schedule changed since these two agreed, so the swap was cancelled rather than applied." },
      { status: 409 }
    );
  }

  const { data: claimed } = await supabaseAdmin
    .from("shift_swap_requests")
    .update({
      status: "accepted",
      approved_by_id: staff.id,
      approved_by_name: staff.name,
      decision_note: note || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "awaiting_admin")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return NextResponse.json({ error: "This request was just handled elsewhere." }, { status: 409 });
  }

  const { error: e1 } = await supabaseAdmin
    .from("employee_schedule_days").update({ employee_id: swap.target_id }).eq("id", reqDay.id);
  const { error: e2 } = await supabaseAdmin
    .from("employee_schedule_days").update({ employee_id: swap.requester_id }).eq("id", tgtDay.id);

  if (e1 || e2) {
    // A half-applied swap leaves one shift unstaffed, which is worse than none.
    await supabaseAdmin.from("employee_schedule_days").update({ employee_id: swap.requester_id }).eq("id", reqDay.id);
    await supabaseAdmin.from("employee_schedule_days").update({ employee_id: swap.target_id }).eq("id", tgtDay.id);
    await supabaseAdmin.from("shift_swap_requests")
      .update({ status: "awaiting_admin", approved_by_id: null, approved_by_name: null, responded_at: null })
      .eq("id", requestId);
    return NextResponse.json({ error: (e1 || e2).message }, { status: 500 });
  }

  await supabaseAdmin.from("activity_log").insert({
    actor_id: staff.id,
    actor_name: staff.name,
    actor_type: "admin",
    action: "approved_shift_swap",
    entity_type: "shift_swap_request",
    entity_id: requestId,
    details: {
      requester: swap.requester?.name,
      target: swap.target?.name,
      requesterDate: reqDay.work_date,
      targetDate: tgtDay.work_date,
    },
  });

  return NextResponse.json({ ok: true, status: "accepted" });
}
