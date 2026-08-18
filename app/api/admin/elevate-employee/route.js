import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

async function requireAdmin(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return null;
  const { data: profile } = await supabaseAdmin.from("staff_profiles").select("role, is_active").eq("id", userData.user.id).single();
  if (!profile || profile.role !== "admin" || !profile.is_active) return null;
  return userData.user;
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

export async function POST(req) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const { employeeId, permissions } = await req.json();
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }

    const { data: employee } = await supabaseAdmin.from("employees").select("*").eq("id", employeeId).single();
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Update permissions on the employee record itself regardless of provisioning state.
    await supabaseAdmin.from("employees").update({ permissions }).eq("id", employeeId);

    const anyGranted = Object.values(permissions || {}).some(Boolean);
    if (!anyGranted) {
      return NextResponse.json({ ok: true, provisioned: false });
    }

    // If a staff account already exists for this employee, just sync its permissions.
    if (employee.staff_account_email) {
      const { data: existingProfile } = await supabaseAdmin
        .from("staff_profiles")
        .select("id")
        .eq("email", employee.staff_account_email)
        .maybeSingle();
      if (existingProfile) {
        await supabaseAdmin.from("staff_profiles").update({ permissions }).eq("id", existingProfile.id);
        return NextResponse.json({ ok: true, provisioned: true, alreadyExisted: true, email: employee.staff_account_email });
      }
    }

    // Provision a new staff dashboard account for this employee.
    const email = `${employee.hr_id.toLowerCase()}@staff.alshrooouk.local`;
    const tempPassword = generateTempPassword();
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: employee.name, employee_id: employeeId },
    });
    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    await supabaseAdmin.from("staff_profiles").insert({
      id: newUser.user.id,
      name: employee.name,
      email,
      role: "staff",
      permissions,
      is_active: true,
    });
    await supabaseAdmin.from("employees").update({ staff_account_email: email }).eq("id", employeeId);

    return NextResponse.json({ ok: true, provisioned: true, alreadyExisted: false, email, tempPassword });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
