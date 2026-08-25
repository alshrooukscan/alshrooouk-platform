import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyEmployeeSession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = await verifyEmployeeSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { transferId, action } = await req.json();
  if (!transferId || !["confirm", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // The transfer must genuinely be addressed to THIS employee - without this
  // check, any logged-in employee could confirm someone else's transfer by
  // guessing/enumerating an id.
  const { data: transfer } = await supabaseAdmin
    .from("expense_transactions")
    .select("id, to_employee_id, status, type")
    .eq("id", transferId)
    .single();

  if (!transfer || transfer.type !== "cash_transfer" || transfer.to_employee_id !== session.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (transfer.status !== "pending") {
    return NextResponse.json({ error: "Already reviewed" }, { status: 409 });
  }

  const { error } = await supabaseAdmin
    .from("expense_transactions")
    .update({
      status: action === "confirm" ? "confirmed" : "rejected",
      confirmed_by_id: session.id,
      confirmed_by_name: session.name,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", transferId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
