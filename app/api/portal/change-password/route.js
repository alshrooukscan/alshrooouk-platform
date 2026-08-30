import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { verifySession } from "../../../../lib/session";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Maps each portal role to where its password actually lives. Patients keep
// theirs in a separate patient_auth table (keyed by patient_id); the other
// three store it directly on their own row.
const TABLE_BY_ROLE = {
  patient: { table: "patient_auth", idColumn: "patient_id" },
  doctor: { table: "doctors", idColumn: "id" },
  employee: { table: "employees", idColumn: "id" },
  client: { table: "clients", idColumn: "id" },
};

function isStrongEnough(password) {
  return typeof password === "string" && password.length >= 8 && /\d/.test(password);
}

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  // Identity comes from the token's signature, which is trustworthy. Whether
  // a password change is actually required is NOT read from the token here -
  // that would be trusting a snapshot taken at login time, which could be
  // stale. This route doesn't need to gate on that anyway: setting a new
  // password is always allowed for the account that's currently logged in,
  // required or not.
  const session = verifySession(token);
  if (!session || !TABLE_BY_ROLE[session.role]) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { newPassword } = await req.json();
    if (!isStrongEnough(newPassword)) {
      return NextResponse.json({ error: "Password must be at least 8 characters and include a number." }, { status: 400 });
    }

    // Verified compatible with the existing verify_*_credentials RPCs' use of
    // Postgres's crypt(): a bcrypt hash is a bcrypt hash regardless of which
    // language generated it. Tested directly against the real RPC before
    // relying on this - a hash made here verified correctly with the right
    // password and correctly failed with the wrong one.
    const hash = await bcrypt.hash(newPassword, 10);
    const { table, idColumn } = TABLE_BY_ROLE[session.role];
    const { error } = await supabaseAdmin
      .from(table)
      .update({ password_hash: hash, must_change_password: false })
      .eq(idColumn, session.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, role: session.role });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed to change password" }, { status: 500 });
  }
}
