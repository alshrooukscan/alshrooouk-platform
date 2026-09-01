import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../../lib/session";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";

// Accept / reject a swap you were asked for, or cancel one you sent.
//
// Acceptance is the only action that touches the schedule, and it does so by
// swapping employee_id between the two rows - the dates and times stay put,
// only who is working them changes.
export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requestId, action } = await req.json();
  if (!requestId || !["accept", "reject", "cancel"].includes(action)) {
    return NextResponse.json({ error: "requestId and a valid action are required" }, { status: 400 });
  }

  const { data: swap } = await supabaseAdmin
    .from("shift_swap_requests")
    .select("*, requester:requester_id(name), target:target_id(name)")
    .eq("id", requestId)
    .maybeSingle();

  if (!swap) {
    return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  }
  if (swap.status !== "pending") {
    return NextResponse.json(
      { error: `This request was already ${swap.status}.` },
      { status: 409 }
    );
  }

  // Only the named colleague can accept or reject; only the sender can cancel.
  if (action === "cancel" && swap.requester_id !== session.id) {
    return NextResponse.json({ error: "Only the person who sent this can cancel it." }, { status: 403 });
  }
  if ((action === "accept" || action === "reject") && swap.target_id !== session.id) {
    return NextResponse.json({ error: "This request wasn't sent to you." }, { status: 403 });
  }

  if (action !== "accept") {
    const { error } = await supabaseAdmin
      .from("shift_swap_requests")
      .update({ status: action === "cancel" ? "cancelled" : "rejected", responded_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: action === "cancel" ? "cancelled" : "rejected" });
  }

  // --- Acceptance: the colleague agrees, but HR still has to sign off ---
  // The colleague's "yes" alone used to rewrite the published roster silently.
  // It now parks the request at awaiting_admin and surfaces it in the Action
  // Center; the schedule is only touched once an admin approves.
  //
  // Both rows are re-read here anyway so an obviously stale request is caught
  // at agreement time rather than sitting in HR's queue until it's rejected.
  const { data: reqDay } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("id, employee_id, work_date")
    .eq("id", swap.requester_day_id)
    .maybeSingle();
  const { data: tgtDay } = await supabaseAdmin
    .from("employee_schedule_days")
    .select("id, employee_id, work_date")
    .eq("id", swap.target_day_id)
    .maybeSingle();

  if (!reqDay || !tgtDay || reqDay.employee_id !== swap.requester_id || tgtDay.employee_id !== swap.target_id) {
    await supabaseAdmin
      .from("shift_swap_requests")
      .update({ status: "cancelled", responded_at: new Date().toISOString() })
      .eq("id", requestId);
    return NextResponse.json(
      { error: "The schedule changed since this was requested, so the swap was cancelled. Please raise it again." },
      { status: 409 }
    );
  }

  const { data: claimed } = await supabaseAdmin
    .from("shift_swap_requests")
    .update({ status: "awaiting_admin", accepted_at: new Date().toISOString(), responded_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return NextResponse.json({ error: "This request was just handled elsewhere." }, { status: 409 });
  }

  await supabaseAdmin.from("activity_log").insert({
    actor_id: session.id,
    actor_name: swap.target?.name || session.name,
    actor_type: "employee",
    action: "agreed_shift_swap",
    entity_type: "shift_swap_request",
    entity_id: requestId,
    details: {
      requester: swap.requester?.name,
      target: swap.target?.name,
      requesterDate: reqDay.work_date,
      targetDate: tgtDay.work_date,
      note: "Awaiting HR approval",
    },
  });

  return NextResponse.json({ ok: true, status: "awaiting_admin" });
}
