import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// patient_auth has RLS enabled with zero policies, so the client-side
// resolveUniqueUsername check (running as the logged-in staff member, subject
// to RLS) always sees an empty result regardless of what's actually in the
// table - meaning it can never actually detect a collision. This route does
// the same "base", "base-2", "base-3"... resolution, but via the service
// role key, which bypasses RLS and can actually see existing usernames.
// Creating a proper RLS policy would be the right permanent fix, but
// Supabase's management API is currently rejecting any SQL that creates a
// function, trigger, or policy with a 403 - this is the workaround until
// that clears.
export async function POST(req) {
  try {
    const { baseUsername, excludeId } = await req.json();
    if (!baseUsername) {
      return NextResponse.json({ error: "baseUsername is required" }, { status: 400 });
    }

    let candidate = baseUsername;
    let suffix = 2;
    for (let attempts = 0; attempts < 50; attempts++) {
      let query = supabaseAdmin.from("patient_auth").select("patient_id").eq("username", candidate).limit(1);
      if (excludeId) query = query.neq("patient_id", excludeId);
      const { data } = await query;
      if (!data || data.length === 0) {
        return NextResponse.json({ username: candidate });
      }
      candidate = `${baseUsername}-${suffix}`;
      suffix += 1;
    }
    return NextResponse.json({ username: `${baseUsername}-${Date.now()}` });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed to resolve username" }, { status: 500 });
  }
}
