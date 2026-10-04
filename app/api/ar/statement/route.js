import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { requireStaff } from "../../../../lib/requireStaff";

// Account statement for one customer on one business: every charge with the
// items behind it at their own prices, every payment, and the balance.
//
// Asked for by Doaa on 4 Oct 2026: a doctor wanted an invoice for what his
// clinic owes and to see what the money was for. The Debt Collection screen
// already listed the sales inside the payment window, but with no unit prices,
// capped at 40 lines, and nothing that could be printed or sent.

// Same people who may see balances on Debt Collection.
function canSee(staff) {
  if (!staff) return false;
  return (
    staff.role === "admin" ||
    staff.permissions?.stock === true ||
    staff.permissions?.reception === true ||
    staff.permissions?.debt_collection === true
  );
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export async function GET(req) {
  const staff = await requireStaff(req);
  if (!canSee(staff)) return NextResponse.json({ error: "You don't have access to account statements." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const brand = searchParams.get("brand");
  if (!customerId || !brand) return NextResponse.json({ error: "customerId and brand are required." }, { status: 400 });

  const { data: ledger, error } = await supabaseAdmin
    .from("customer_ar_ledger")
    .select("id, customer_type, direction, amount, payment_method, reference_type, reference_id, receipt_no, note, entry_date, is_opening_balance, created_at")
    .eq("customer_id", customerId)
    .eq("brand", brand)
    .order("entry_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ledger?.length) return NextResponse.json({ error: "No account history for this customer." }, { status: 404 });

  // Who the customer is. Debts sit on the clinic, so name the doctors behind it.
  const type = ledger[0].customer_type;
  let customer = { type, name: null, clinic_code: null, doctors: [], phone: null };
  if (type === "clinic") {
    const { data: c } = await supabaseAdmin.from("clinics").select("name, code").eq("id", customerId).maybeSingle();
    customer.clinic_code = c?.code || null;
    customer.name = c?.name && c.name !== "0" ? c.name : c?.code ? `Clinic ${c.code}` : "Clinic";
    if (c?.code) {
      const { data: ds } = await supabaseAdmin.from("doctors").select("name, phone").eq("clinic_code", c.code).order("name");
      customer.doctors = (ds || []).map((d) => d.name);
      customer.phone = (ds || []).find((d) => d.phone)?.phone || null;
    }
  } else if (type === "doctor") {
    const { data: d } = await supabaseAdmin.from("doctors").select("name, clinic_code, phone").eq("id", customerId).maybeSingle();
    customer = { ...customer, name: d?.name || "Doctor", clinic_code: d?.clinic_code || null, phone: d?.phone || null };
  } else if (type === "client") {
    const { data: c } = await supabaseAdmin.from("clients").select("name").eq("id", customerId).maybeSingle();
    customer.name = c?.name || "Client";
  } else {
    customer.name = type;
  }

  // The items behind each charge, at the price each was sold at.
  const saleIds = ledger.filter((l) => l.reference_type === "counter_sale" && l.reference_id).map((l) => l.reference_id);
  const orderIds = ledger.filter((l) => l.reference_type === "dental_order" && l.reference_id).map((l) => l.reference_id);
  const [salesRes, saleLinesRes, orderLinesRes] = await Promise.all([
    saleIds.length ? supabaseAdmin.from("counter_sales").select("id, receipt_no").in("id", saleIds) : { data: [] },
    saleIds.length ? supabaseAdmin.from("counter_sale_items").select("sale_id, item_name, quantity, unit_price, line_total").in("sale_id", saleIds) : { data: [] },
    orderIds.length ? supabaseAdmin.from("dental_order_items").select("order_id, item_name, quantity, unit_price, line_total").in("order_id", orderIds) : { data: [] },
  ]);
  const receiptBySale = Object.fromEntries((salesRes.data || []).map((s) => [s.id, s.receipt_no]));
  const linesByRef = {};
  for (const l of saleLinesRes.data || []) (linesByRef[l.sale_id] ||= []).push({ item: l.item_name, qty: Number(l.quantity), unit_price: Number(l.unit_price), line_total: Number(l.line_total) });
  for (const l of orderLinesRes.data || []) (linesByRef[l.order_id] ||= []).push({ item: l.item_name, qty: Number(l.quantity), unit_price: Number(l.unit_price), line_total: Number(l.line_total) });

  let charged = 0;
  let paid = 0;
  const entries = ledger.map((l) => {
    const amount = round2(l.amount);
    const lines = linesByRef[l.reference_id] || [];
    const kind = l.direction === "charge" ? "charge" : l.direction === "payment" ? "payment" : "adjustment";
    if (kind === "charge") charged += amount;
    else paid += amount;

    let label;
    if (kind === "payment") label = "Payment received";
    else if (kind === "adjustment") label = l.note || "Adjustment";
    else if (l.reference_type === "counter_sale") label = "Sale";
    else if (l.reference_type === "dental_order") label = "Order from the doctor portal";
    else if (l.is_opening_balance || !l.reference_type) label = "Balance carried over from before the platform";
    else label = l.note || "Charge";

    // Anything the item prices do not account for (a discount, a delivery
    // charge) is shown as its own line, so the items always add up to the
    // amount charged rather than leaving the reader to wonder.
    const itemsTotal = round2(lines.reduce((s, x) => s + x.line_total, 0));
    const difference = lines.length && kind === "charge" ? round2(amount - itemsTotal) : 0;

    return {
      id: l.id,
      date: l.entry_date,
      kind,
      label,
      receipt_no: receiptBySale[l.reference_id] || l.receipt_no || null,
      payment_method: kind === "payment" ? l.payment_method : null,
      note: l.note && label !== l.note ? l.note : null,
      amount,
      lines,
      difference,
    };
  });

  return NextResponse.json({
    customer,
    brand,
    entries,
    totals: { charged: round2(charged), paid: round2(paid), balance: round2(charged - paid) },
    generated_at: new Date().toISOString(),
    generated_by: staff.name || null,
  });
}
