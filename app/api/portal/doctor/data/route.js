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
  // Only operational status is exposed to doctors, never payment/financial data.
  const { data: visits } = await supabaseAdmin
    .from("visits")
    .select("id, patient_id, scan_types, exam_date, scanned, raw_data_uploaded, report_done, patients(name, mobile)")
    .eq("doctor_id", session.id)
    .order("exam_date", { ascending: false });

  return NextResponse.json({ doctor, visits: visits || [] });
}
