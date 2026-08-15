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

  const { eventType, lat, lng } = await req.json();
  if (!["login", "logout"].includes(eventType)) {
    return NextResponse.json({ error: "eventType must be login or logout" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("timeclock_events")
    .insert({ employee_id: session.id, event_type: eventType, lat, lng })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
