import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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

    if (type === "patient" || type === "doctor" || type === "employee" || type === "client") {
      const table =
        type === "patient" ? "patients" :
        type === "doctor" ? "doctors" :
        type === "client" ? "clients" : "employees";
      const { data: record } = await supabaseAdmin.from(table).select("id, name").eq("id", id).single();
      if (!record) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      // `impersonated` is what the portal data routes check to skip the forced
      // password-change redirect. Without it, Login As lands on the "set a new
      // password" screen for every account still carrying must_change_password
      // (which, after Phase 7, is nearly all of them) instead of the real portal.
      const payload = {
        role: type,
        id: record.id,
        name: record.name,
        impersonated: true,
        impersonatedBy: admin.adminName,
      };

      // Employee portal sessions are single-active-session enforced (see lib/session.js
      // verifyEmployeeSession) - every real login writes a fresh sessionId to
      // employees.current_session_id and every request checks it still matches.
      // Login-as has to do the same thing, or the impersonated session gets rejected
      // on its very first API call and bounces straight back to the login page.
      if (type === "employee") {
        const sessionId = randomUUID();
        await supabaseAdmin.from("employees").update({ current_session_id: sessionId }).eq("id", record.id);
        payload.sessionId = sessionId;
      }

      await supabaseAdmin.from("activity_log").insert({
        actor_id: admin.id,
        actor_name: admin.adminName,
        actor_type: "admin",
        action: "logged_in_as",
        entity_type: type,
        entity_id: record.id,
        details: { targetName: record.name },
      });

      const token = signSession(payload);
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
