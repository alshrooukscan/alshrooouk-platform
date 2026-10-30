import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "../../../../../lib/session";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { buildAccountEntries } from "../../../../../lib/arStatement";

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

  // Items picked up at reception (counter sales). They never appeared here, so
  // Dr. Amr Mansour (clinic 358, 30 Oct 2026) had 31 pickups on account and an
  // empty Supply Orders tab. A sale can be booked on the doctor, on another
  // doctor at the same clinic, or on the clinic itself; all are the clinic's.
  const { data: me } = await supabaseAdmin.from("doctors").select("clinic_code").eq("id", session.id).maybeSingle();
  const customerIds = [session.id];
  if (me?.clinic_code) {
    const [{ data: clinic }, { data: peers }] = await Promise.all([
      supabaseAdmin.from("clinics").select("id").eq("code", me.clinic_code).maybeSingle(),
      supabaseAdmin.from("doctors").select("id").eq("clinic_code", me.clinic_code),
    ]);
    if (clinic?.id) customerIds.push(clinic.id);
    for (const d of peers || []) if (!customerIds.includes(d.id)) customerIds.push(d.id);
  }
  const { data: sales } = await supabaseAdmin
    .from("counter_sales")
    .select("id, receipt_no, entry_date, created_at, net_amount, gross_amount, discount_percent, payment_method, brand")
    .in("customer_id", customerIds)
    .order("created_at", { ascending: false })
    .limit(100);
  const saleIds = (sales || []).map((x) => x.id);
  const { data: saleLines } = saleIds.length
    ? await supabaseAdmin.from("counter_sale_items").select("sale_id, item_name, quantity, unit_price, line_total").in("sale_id", saleIds)
    : { data: [] };
  const linesBySale = {};
  for (const l of saleLines || []) (linesBySale[l.sale_id] ||= []).push(l);
  const pickups = (sales || []).map((x) => ({
    id: x.id, receipt_no: x.receipt_no, date: x.entry_date || String(x.created_at).slice(0, 10),
    amount: Number(x.net_amount || 0), discount_percent: Number(x.discount_percent || 0),
    on_account: x.payment_method === "postponed", payment_method: x.payment_method,
    items: (linesBySale[x.id] || []).map((l) => ({ item_name: l.item_name, quantity: Number(l.quantity), unit_price: Number(l.unit_price), line_total: Number(l.line_total) })),
  }));

  // Which on-account pickups are still open. Payments clear the oldest first,
  // so the open ones are the newest that add up to today's balance.
  try {
    const owners = customerIds.map((id) => ({ id }));
    const { totals } = await buildAccountEntries(owners, "dental_stock");
    let remaining = Math.max(Number(totals.balance || 0), 0);
    for (const x of pickups) {
      if (!x.on_account) { x.status = "paid"; continue; }
      if (remaining <= 0.005) { x.status = "settled"; continue; }
      x.status = remaining + 0.005 >= x.amount ? "open" : "partly";
      remaining = Math.round((remaining - x.amount) * 100) / 100;
    }
  } catch {
    for (const x of pickups) x.status = x.on_account ? "open" : "paid";
  }

  return NextResponse.json({ orders: shaped, itemRequests: requests || [], pickups });
}
