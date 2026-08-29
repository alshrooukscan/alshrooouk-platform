import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../../lib/session";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";

const VALID_METHODS = ["cash", "visa", "instapay", "vodafone_cash"];

export async function POST(req) {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const items = Array.isArray(body.items) ? body.items : [];
  const paymentMethod = body.paymentMethod;

  if (items.length === 0) {
    return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
  }
  if (!VALID_METHODS.includes(paymentMethod)) {
    return NextResponse.json({ error: "Choose a valid payment method." }, { status: 400 });
  }

  // Prices and stock are validated fresh, server-side, inside the function
  // itself - only stock_item_id and quantity from the client are ever used.
  const cleanItems = items.map((it) => ({ stock_item_id: it.stockItemId, quantity: it.quantity }));

  const { data: orderId, error } = await supabaseAdmin.rpc("place_dental_order", {
    p_doctor_id: session.id,
    p_payment_method: paymentMethod,
    p_items: cleanItems,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, orderId });
}
