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
