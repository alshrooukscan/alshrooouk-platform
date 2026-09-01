import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";

// Admin review of attendance corrections. This is the only code path that
// writes to timeclock_events after the fact, because those records feed
// payroll - an employee can ask, but only an admin can change the record.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Staff access required" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("timeclock_correction_requests")
    .select("*, employees(name), timeclock_events(event_type, event_time, face_match_status, distance_from_clinic_meters, address)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return NextResponse.json({ requests: data || [] });
}

export async function POST(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Staff access required" }, { status: 401 });
  if (staff.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can decide attendance corrections." }, { status: 403 });
  }

  const { requestId, action, note } = await req.json();
  if (!requestId || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "requestId and a valid action are required" }, { status: 400 });
  }

  const { data: rq } = await supabaseAdmin
    .from("timeclock_correction_requests")
    .select("*, employees(name)")
    .eq("id", requestId)
    .maybeSingle();

  if (!rq) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  if (rq.status !== "pending") {
    return NextResponse.json({ error: `This request was already ${rq.status}.` }, { status: 409 });
  }

  // Claim it first so two admins cannot both apply the same correction.
  const { data: claimed } = await supabaseAdmin
    .from("timeclock_correction_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_by_id: staff.id,
      reviewed_by_name: staff.name,
      review_note: note || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return NextResponse.json({ error: "This request was just handled elsewhere." }, { status: 409 });
  }

  if (action === "reject") {
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  const stamp = `Corrected ${new Date().toISOString().slice(0, 10)} by ${staff.name}: ${rq.request_kind.replace(/_/g, " ")}`;

  if (rq.request_kind === "missing_punch") {
    // A punch that never happened has to be created, not edited. It is marked
    // as manually added so it is never mistaken for a real device reading.
    const { error } = await supabaseAdmin.from("timeclock_events").insert({
      employee_id: rq.employee_id,
      event_type: rq.proposed_event_type || "login",
      event_time: rq.proposed_event_time,
      face_match_status: "manual_entry",
      corrected_by_request_id: rq.id,
      correction_note: stamp,
    });
    if (error) {
      await supabaseAdmin.from("timeclock_correction_requests")
        .update({ status: "pending", reviewed_at: null, reviewed_by_id: null, reviewed_by_name: null })
        .eq("id", requestId);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else if (rq.event_id) {
    const { data: ev } = await supabaseAdmin
      .from("timeclock_events")
      .select("event_time, original_event_time")
      .eq("id", rq.event_id)
      .maybeSingle();

    const update = { corrected_by_request_id: rq.id, correction_note: stamp };
    if (rq.proposed_event_time) {
      // Keep the original reading the first time it is corrected, so the
      // device's own record is never lost behind an amendment.
      update.original_event_time = ev?.original_event_time || ev?.event_time || null;
      update.event_time = rq.proposed_event_time;
    }
    if (rq.request_kind === "face_not_recognised") update.face_match_status = "verified_by_admin";
    if (rq.request_kind === "wrong_location") update.distance_from_clinic_meters = 0;

    const { error } = await supabaseAdmin.from("timeclock_events").update(update).eq("id", rq.event_id);
    if (error) {
      await supabaseAdmin.from("timeclock_correction_requests")
        .update({ status: "pending", reviewed_at: null, reviewed_by_id: null, reviewed_by_name: null })
        .eq("id", requestId);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await supabaseAdmin.from("activity_log").insert({
    actor_id: staff.id,
    actor_name: staff.name,
    actor_type: "admin",
    action: "approved_timeclock_correction",
    entity_type: "timeclock_correction_request",
    entity_id: requestId,
    details: {
      employee: rq.employees?.name,
      kind: rq.request_kind,
      newTime: rq.proposed_event_time,
    },
  });

  return NextResponse.json({ ok: true, status: "approved" });
}
