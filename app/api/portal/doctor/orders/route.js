import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

// A doctor's own dental orders, their lines, and their delivery code.
//
// The code is the same four digits the staff screen shows. It is what the
// doctor reads back to whoever brings the order, so it has to be visible to
// them the moment it exists - previously it went out over WhatsApp only, and a
// doctor who lost the message had no way to take delivery.
//
// Scoped to session.id throughout: a doctor can only ever see their own
// orders, and no other doctor's code.
export async function GET() {
  const token = cookies().get("portal_session")?.value;
  const session = verifySession(token);
  if (!session || session.role !== "doctor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: orders } = await supabaseAdmin
    .from("dental_orders")
    .select(
      "id, status, fulfillment, payment_status, total_amount, amount_paid, pay_later, created_at, reviewed_at, delivered_at, delivery_otp, otp_verified_at, note"
    )
    .eq("doctor_id", session.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const ids = (orders || []).map((o) => o.id);
  const { data: lines } = ids.length
    ? await supabaseAdmin
        .from("dental_order_items")
        .select("order_id, item_name, quantity, unit_price, line_total")
        .in("order_id", ids)
    : { data: [] };

  const byOrder = {};
  for (const l of lines || []) {
    (byOrder[l.order_id] = byOrder[l.order_id] || []).push(l);
  }

  const shaped = (orders || []).map((o) => ({
    ...o,
    items: byOrder[o.id] || [],
    // Withheld until an employee has reviewed the order. Before that the order
    // may still be cancelled or corrected, and a code handed out early is a
    // code the doctor may try to use against an order that no longer stands.
    delivery_otp: o.status === "placed" || o.status === "cancelled" ? null : o.delivery_otp,
  }));

  const { data: requests } = await supabaseAdmin
    .from("stock_item_requests")
    .select("id, item_name, quantity, note, status, created_at")
    .eq("doctor_id", session.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ orders: shaped, itemRequests: requests || [] });
}
