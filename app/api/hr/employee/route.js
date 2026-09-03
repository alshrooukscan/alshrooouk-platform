import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";

// Salary, national ID, password hash and the face biometric template are no
// longer readable directly from the browser - the database revoked those
// columns from signed-in staff, because per-page permissions only ever guarded
// the interface, not the data underneath.
//
// This route is the sanctioned way in. It re-checks admin server-side, so the
// check cannot be skipped by calling the API directly.
export async function GET(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const search = url.searchParams.get("search");

  const isHrAdmin = staff.role === "admin" || staff.permissions?.hr === true;
  if (!isHrAdmin) {
    return NextResponse.json({ error: "You don't have access to employee records." }, { status: 403 });
  }

  if (id) {
    const { data, error } = await supabaseAdmin.from("employees").select("*").eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    // The password hash is never needed by any screen, so it does not leave the
    // database even for an admin.
    delete data.password_hash;
    return NextResponse.json({ employee: data });
  }

  if (search !== null) {
    // Used by Login As, which needs each employee's permissions to show what
    // they would be able to see. Deliberately narrow: no salary, no national id.
    const { data, error } = await supabaseAdmin
      .from("employees")
      .select("id, name, hr_id, permissions")
      .ilike("name", `%${search}%`)
      .limit(15);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ employees: data || [] });
  }

  return NextResponse.json({ error: "Pass an id or a search term." }, { status: 400 });
}

// Salary and national ID were readable only through the GET above, but were
// still being WRITTEN straight from the browser, which meant the authenticated
// role needed table-level INSERT/UPDATE/DELETE on employees - i.e. any signed-in
// member of staff could rewrite or delete any employee record, salary included,
// by calling the API directly. These three handlers are the sanctioned path so
// that grant can be withdrawn.
function hrGuard(staff) {
  if (!staff) return { status: 401, error: "Sign in first." };
  const isHrAdmin = staff.role === "admin" || staff.permissions?.hr === true;
  if (!isHrAdmin) return { status: 403, error: "You don't have access to employee records." };
  return null;
}

const WRITABLE = [
  "name", "phone", "role", "national_id",
  "fixed_salary", "variable_salary", "hourly_rate",
  "branch_id", "is_active",
];

// Only ever copies the fields a screen is allowed to set. Anything else in the
// request body - permissions, password_hash, current_session_id - is dropped
// rather than trusted, so this route cannot become a privilege-escalation path.
function pickWritable(body) {
  const out = {};
  for (const k of WRITABLE) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

export async function POST(req) {
  const staff = await requireStaff(req);
  const denied = hrGuard(staff);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  try {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

    const { data: hrId, error: hrErr } = await supabaseAdmin.rpc("generate_hr_id");
    if (hrErr) return NextResponse.json({ error: hrErr.message }, { status: 500 });

    // A new employee belongs to whichever branch the admin creating them works
    // out of, unless the caller says otherwise. Taken from the server-side
    // session rather than the request body so it cannot be spoofed.
    const row = { ...pickWritable(body), hr_id: hrId };
    if (row.branch_id == null) row.branch_id = staff.branch_id || null;
    const { data, error } = await supabaseAdmin.from("employees").insert(row).select("id, hr_id").single();
    if (error) {
      // 23505 is the unique violation the old client-side insert special-cased.
      const msg = error.code === "23505" ? "National ID already exists." : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ employee: data });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not create employee." }, { status: 500 });
  }
}

export async function PATCH(req) {
  const staff = await requireStaff(req);
  const denied = hrGuard(staff);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  try {
    const body = await req.json();
    const id = body.id;
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const patch = pickWritable(body);
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    const { error } = await supabaseAdmin.from("employees").update(patch).eq("id", id);
    if (error) {
      const msg = error.code === "23505" ? "National ID already exists." : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Could not update employee." }, { status: 500 });
  }
}

// Deleting an employee is admin-only - the hr permission is enough to edit one,
// but not to destroy the record and its payroll history.
export async function DELETE(req) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (staff.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can delete an employee." }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const { error } = await supabaseAdmin.from("employees").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
