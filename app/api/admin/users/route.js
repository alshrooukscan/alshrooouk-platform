import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import crypto from "crypto";

async function requireAdmin(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;

  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: profile } = await supabaseAdmin
    .from("staff_profiles")
    .select("role, is_active")
    .eq("id", userData.user.id)
    .single();

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
    const { email, name, permissions } = await req.json();
    if (!email || !name) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    const tempPassword = generateTempPassword();
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    const { error: profileErr } = await supabaseAdmin.from("staff_profiles").insert({
      id: newUser.user.id,
      name,
      email,
      role: "staff",
      permissions: permissions || {},
      is_active: true,
    });

    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, email, tempPassword });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
