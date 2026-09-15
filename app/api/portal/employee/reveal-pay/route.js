import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// Pay figures in the employee portal are hidden until the person proves it is
// them. Being logged in is not the same as choosing to show your salary to
// whoever is standing behind you, or to whoever picks up a phone left on a
// desk.
//
// The password is checked here, never in the browser: nothing that decides
// whether money is shown should be decidable by the page asking for it.

// A password box that can be tried over and over is a place to guess
// passwords. Kept in memory deliberately - it is a speed bump for someone
// holding a colleague's unlocked phone, not a defence against a determined
// attacker, and it costs nothing. A server restart clears it, which is
// acceptable for what it protects.
const attempts = new Map();
const MAX_TRIES = 5;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyTries(id) {
  const rec = attempts.get(id);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(id); return false; }
  return rec.count >= MAX_TRIES;
}

function recordFailure(id) {
  const rec = attempts.get(id);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(id, { count: 1, first: Date.now() });
    return;
  }
  rec.count += 1;
}

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = await verifyEmployeeSession(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // An admin viewing through Login as never had this person's password and is
  // not being asked for one - that is the agreed behaviour. Their own session
  // is what authorises it, and the portal labels the impersonation on screen so
  // it is never unclear who is looking.
  if (session.impersonated) return NextResponse.json({ ok: true, impersonated: true });

  if (tooManyTries(session.id)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const { password } = await req.json().catch(() => ({}));
  const { data: ok } = await supabaseAdmin.rpc("verify_employee_password", {
    p_employee_id: session.id,
    p_password: password || "",
  });

  if (ok !== true) {
    recordFailure(session.id);
    // One message for every failure. Saying more would help somebody guessing.
    return NextResponse.json({ error: "That password is not right." }, { status: 401 });
  }

  attempts.delete(session.id);
  return NextResponse.json({ ok: true });
}
