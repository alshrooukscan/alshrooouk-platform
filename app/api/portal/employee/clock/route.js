import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { ensureEmployeePhotosFolder } from "../../../../../lib/folderProvisioning";
import { uploadFile } from "../../../../../lib/googleDrive";

// Standard face-api.js recognition threshold - distances below this between two
// descriptors of the same real face are typical; above it, different people.
const FACE_MATCH_THRESHOLD = 0.6;

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

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
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { eventType, lat, lng, faceDescriptor, faceCaptureBase64 } = await req.json();
  if (!["login", "logout"].includes(eventType)) {
    return NextResponse.json({ error: "eventType must be login or logout" }, { status: 400 });
  }

  if (lat == null || lng == null) {
    return NextResponse.json({ error: "Location is required to sign in or out." }, { status: 400 });
  }

  // Location is the one hard gate - proven, reliable, never a false-lockout risk.
  const distance = haversineMeters(CLINIC_LAT, CLINIC_LNG, lat, lng);
  if (distance > ALLOWED_RADIUS_METERS) {
    return NextResponse.json(
      { error: `You must be at the clinic to sign in or out. You appear to be about ${Math.round(distance)}m away.` },
      { status: 403 }
    );
  }

  // Face is a soft signal - recorded and flagged on mismatch, but it never blocks
  // a real clock-in. A self-hosted model will sometimes miss on lighting/angle,
  // and that shouldn't be able to cost someone their attendance record.
  const { data: emp } = await supabaseAdmin.from("employees").select("face_descriptor").eq("id", session.id).single();
  let faceMatchStatus = "not_enrolled";
  let faceMatchDistance = null;
  let faceCaptureDriveId = null;

  if (emp?.face_descriptor) {
    if (Array.isArray(faceDescriptor) && faceDescriptor.length === 128) {
      faceMatchDistance = euclideanDistance(emp.face_descriptor, faceDescriptor);
      faceMatchStatus = faceMatchDistance <= FACE_MATCH_THRESHOLD ? "verified" : "failed";
    } else {
      faceMatchStatus = "failed";
    }

    if (faceMatchStatus === "failed" && faceCaptureBase64) {
      try {
        const folderId = await ensureEmployeePhotosFolder();
        const buffer = Buffer.from(faceCaptureBase64, "base64");
        const file = await uploadFile(folderId, `unmatched_${session.id}_${Date.now()}.jpg`, "image/jpeg", buffer);
        faceCaptureDriveId = file.id;
      } catch (uploadErr) {
        // A failed upload of the review photo should never block attendance itself,
        // but it should be visible in the logs rather than silently disappearing -
        // this exact gap made a real mismatch undiagnosable once already.
        console.error("Failed to upload unmatched face capture for employee", session.id, uploadErr);
      }
    }
  }

  // IP is read server-side from the request itself, never trusted from the client body,
  // that's what makes this usable as a real attendance record rather than something
  // an employee could fake from their own browser.
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : req.headers.get("x-real-ip") || null;

  const address = await reverseGeocode(lat, lng);

  const { data, error } = await supabaseAdmin
    .from("timeclock_events")
    .insert({
      employee_id: session.id,
      event_type: eventType,
      lat,
      lng,
      ip_address: ip,
      address,
      face_match_status: faceMatchStatus,
      face_match_distance: faceMatchDistance,
      face_capture_drive_id: faceCaptureDriveId,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data, faceMatchStatus });
}
