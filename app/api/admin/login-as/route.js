import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { signSession } from "../../../../lib/session";

async function requireAdmin(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return null;
  const { data: profile } = await supabaseAdmin.from("staff_profiles").select("role, is_active, name").eq("id", userData.user.id).single();
  if (!profile || profile.role !== "admin" || !profile.is_active) return null;
  return { ...userData.user, adminName: profile.name };
}

export async function POST(req) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const { type, id } = await req.json();
    if (!type || !id) {
      return NextResponse.json({ error: "type and id are required" }, { status: 400 });
    }

    if (type === "patient" || type === "doctor" || type === "employee") {
      const table = type === "patient" ? "patients" : type === "doctor" ? "doctors" : "employees";
      const { data: record } = await supabaseAdmin.from(table).select("id, name").eq("id", id).single();
      if (!record) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const token = signSession({ role: type, id: record.id, name: record.name, impersonatedBy: admin.adminName });
      const res = NextResponse.json({ ok: true, role: type, name: record.name, redirect: `/portal/${type}` });
      res.cookies.set("portal_session", token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 2, // impersonation sessions are shorter-lived than real logins
      });
      return res;
    }

    if (type === "staff") {
      const { data: profile } = await supabaseAdmin.from("staff_profiles").select("email, name").eq("id", id).single();
      if (!profile) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: profile.email });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, role: "staff", name: profile.name, link: data.properties.action_link });
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
