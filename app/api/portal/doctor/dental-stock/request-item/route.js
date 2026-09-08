import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../../lib/session";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";

// A doctor asking for something the catalogue does not carry at all. This is
// deliberately not an order: there is no stock item, no price and nothing to
// reserve. It is a request for the team to decide whether to stock it, and it
// must never touch the ledger or the shelf.
export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemName, quantity, note } = await req.json();
  if (!itemName || !String(itemName).trim()) {
    return NextResponse.json({ error: "Tell us what you need." }, { status: 400 });
  }

  const qty = Number(quantity);
  const { error } = await supabaseAdmin.from("stock_item_requests").insert({
    // Taken from the session, never the request body: a doctor can only ask
    // for something on their own behalf.
    doctor_id: session.id,
    item_name: String(itemName).trim().slice(0, 200),
    quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
    note: note ? String(note).trim().slice(0, 1000) : null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
