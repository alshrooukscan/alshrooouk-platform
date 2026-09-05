import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// patient_auth has RLS enabled with zero policies, so a staff member's own
// client can never read it - the dashboard's query for a patient's username
// always came back empty, which meant the Portal Access card believed nobody
// had an account and always offered "Generate Login" (a reset) instead of
// showing the existing one.
//
// It also has to answer a second question now: has this person already set a
// password of their own? If they have, messaging them must not carry a new
// password, because issuing one silently invalidates the one they chose.
//
// Deliberately returns no password material of any kind - only whether an
// account exists, the username, and whether the account is still on a
// staff-issued temporary password. There is nothing here that could be used
// to log in as the patient.
export async function POST(req) {
  try {
    const { patientId } = await req.json();
    if (!patientId) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("patient_auth")
      .select("username, must_change_password")
      .eq("patient_id", patientId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ hasAccount: false, username: null, hasOwnPassword: false });
    }

    return NextResponse.json({
      hasAccount: true,
      username: data.username,
      // The flag records the inverse: it is set while the password is still a
      // staff-issued temporary one, and cleared the moment the person chooses
      // their own. Naming it positively here keeps the calling code readable.
      hasOwnPassword: !data.must_change_password,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed to read credential status" }, { status: 500 });
  }
}
