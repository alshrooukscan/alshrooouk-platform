import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: doctor } = await supabaseAdmin.from("doctors").select("id, name, clinic_name, clinic_code").eq("id", session.id).single();
  const { data: visits } = await supabaseAdmin
    .from("visits")
    .select("id, scan_types, exam_date, payment_status, patients(name)")
    .eq("doctor_id", session.id)
    .order("exam_date", { ascending: false });

  return NextResponse.json({ doctor, visits: visits || [] });
}
