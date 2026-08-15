import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { signSession } from "../../../../lib/session";

const FN = { patient: "verify_patient_credentials", doctor: "verify_doctor_credentials", employee: "verify_employee_credentials" };

export async function POST(req) {
  try {
    const { role, username, password } = await req.json();
    if (!role || !FN[role] || !username || !password) {
      return NextResponse.json({ error: "role, username, and password are required" }, { status: 400 });
    }

    const { data: id, error } = await supabaseAdmin.rpc(FN[role], { p_username: username, p_password: password });
    if (error || !id) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    let name = "";
    if (role === "patient") {
      const { data } = await supabaseAdmin.from("patients").select("name").eq("id", id).single();
      name = data?.name;
    } else if (role === "doctor") {
      const { data } = await supabaseAdmin.from("doctors").select("name").eq("id", id).single();
      name = data?.name;
    } else {
      const { data } = await supabaseAdmin.from("employees").select("name").eq("id", id).single();
      name = data?.name;
    }

    const token = signSession({ role, id, name });
    const res = NextResponse.json({ ok: true, role, name });
    res.cookies.set("portal_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
