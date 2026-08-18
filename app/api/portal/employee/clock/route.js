import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
      { headers: { "User-Agent": "AlShrooouk-Platform/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch (e) {
    return null;
  }
}

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

  // IP is read server-side from the request itself, never trusted from the client body,
  // that's what makes this usable as a real attendance record rather than something
  // an employee could fake from their own browser.
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : req.headers.get("x-real-ip") || null;

  const address = await reverseGeocode(lat, lng);

  const { data, error } = await supabaseAdmin
    .from("timeclock_events")
    .insert({ employee_id: session.id, event_type: eventType, lat, lng, ip_address: ip, address })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
