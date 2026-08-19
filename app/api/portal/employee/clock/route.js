import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// The clinic's real location (resolved from the CEO-provided Google Maps link).
// Radius is generous enough to absorb normal GPS drift (indoor/multi-floor) while
// still ruling out signing in from home or elsewhere.
const CLINIC_LAT = 30.0592582;
const CLINIC_LNG = 31.3682106;
const ALLOWED_RADIUS_METERS = 250;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

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

  if (lat == null || lng == null) {
    return NextResponse.json({ error: "Location is required to sign in or out." }, { status: 400 });
  }

  const distance = haversineMeters(CLINIC_LAT, CLINIC_LNG, lat, lng);
  if (distance > ALLOWED_RADIUS_METERS) {
    return NextResponse.json(
      { error: `You must be at the clinic to sign in or out. You appear to be about ${Math.round(distance)}m away.` },
      { status: 403 }
    );
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
