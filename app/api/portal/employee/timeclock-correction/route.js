import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// An employee asking for a sign-in/out record to be corrected. Nothing here
// touches timeclock_events - these records feed payroll, so the only path that
// edits them is an admin approving the request.
export async function GET() {
  const session = await verifyEmployeeSession(cookies().get("portal_session")?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: events } = await supabaseAdmin
    .from("timeclock_events")
    .select("id, event_type, event_time, face_match_status, distance_from_clinic_meters, address, correction_note")
    .eq("employee_id", session.id)
    .order("event_time", { ascending: false })
    .limit(60);

  const { data: requests } = await supabaseAdmin
    .from("timeclock_correction_requests")
    .select("*")
    .eq("employee_id", session.id)
    .order("created_at", { ascending: false })
    .limit(40);

  return NextResponse.json({ events: events || [], requests: requests || [] });
}

export async function POST(req) {
  const session = await verifyEmployeeSession(cookies().get("portal_session")?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId, requestKind, proposedEventTime, proposedEventType, reason } = await req.json();

  if (!requestKind) return NextResponse.json({ error: "Choose what the problem is." }, { status: 400 });
  if (!reason || !reason.trim()) {
    return NextResponse.json({ error: "Explain what happened so an admin can check it." }, { status: 400 });
  }
  if (requestKind !== "missing_punch" && !eventId) {
    return NextResponse.json({ error: "Pick the sign-in or sign-out record this is about." }, { status: 400 });
  }
  if (requestKind === "missing_punch" && !proposedEventTime) {
    return NextResponse.json({ error: "Give the date and time you actually signed in or out." }, { status: 400 });
  }

  // Only ever against your OWN record, so nobody can raise a correction on a
  // colleague's attendance.
  if (eventId) {
    const { data: ev } = await supabaseAdmin
      .from("timeclock_events")
      .select("id, employee_id")
      .eq("id", eventId)
      .maybeSingle();
    if (!ev || ev.employee_id !== session.id) {
      return NextResponse.json({ error: "That record isn't yours." }, { status: 403 });
    }
    const { data: dupe } = await supabaseAdmin
      .from("timeclock_correction_requests")
      .select("id")
      .eq("event_id", eventId)
      .eq("status", "pending")
      .maybeSingle();
    if (dupe) {
      return NextResponse.json({ error: "You already have a pending request for that record." }, { status: 409 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("timeclock_correction_requests")
    .insert({
      employee_id: session.id,
      event_id: eventId || null,
      request_kind: requestKind,
      proposed_event_time: proposedEventTime || null,
      proposed_event_type: proposedEventType || null,
      reason: reason.trim(),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
