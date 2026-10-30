import { supabaseAdmin } from "./supabaseAdmin";

// One account statement builder, used by reception's printable statement and
// invoice (/api/ar/statement) and by the doctor portal, so a doctor reads the
// same lines, prices and balance that reception prints.
//
// owners: [{ type, id }] - the ledger rows of every owner are merged, oldest
// first (a clinic's debts can sit on the clinic or, from before Oct, on one of
// its doctors). brand: optional filter.

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export async function buildAccountEntries(owners, brand = null) {
  const ledger = [];
  for (const o of owners) {
    if (!o?.id) continue;
    let q = supabaseAdmin
      .from("customer_ar_ledger")
      .select("id, customer_type, brand, direction, amount, payment_method, reference_type, reference_id, receipt_no, note, entry_date, is_opening_balance, created_at")
      .eq("customer_id", o.id);
    if (o.type) q = q.eq("customer_type", o.type);
    if (brand) q = q.eq("brand", brand);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    ledger.push(...(data || []));
  }
  ledger.sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.created_at < b.created_at ? -1 : 1));

  const saleIds = ledger.filter((l) => l.reference_type === "counter_sale" && l.reference_id).map((l) => l.reference_id);
  const orderIds = ledger.filter((l) => l.reference_type === "dental_order" && l.reference_id).map((l) => l.reference_id);
  const returnIds = ledger.filter((l) => l.reference_type === "sale_return" && l.reference_id).map((l) => l.reference_id);
  const [salesRes, saleLinesRes, orderLinesRes, returnLinesRes] = await Promise.all([
    saleIds.length ? supabaseAdmin.from("counter_sales").select("id, receipt_no").in("id", saleIds) : { data: [] },
    saleIds.length ? supabaseAdmin.from("counter_sale_items").select("sale_id, item_name, quantity, unit_price, line_total").in("sale_id", saleIds) : { data: [] },
    orderIds.length ? supabaseAdmin.from("dental_order_items").select("order_id, item_name, quantity, unit_price, line_total").in("order_id", orderIds) : { data: [] },
    returnIds.length ? supabaseAdmin.from("sale_return_lines").select("return_id, item_name, qty, unit_price").in("return_id", returnIds) : { data: [] },
  ]);
  const receiptBySale = Object.fromEntries((salesRes.data || []).map((s) => [s.id, s.receipt_no]));
  const linesByRef = {};
  for (const l of saleLinesRes.data || []) (linesByRef[l.sale_id] ||= []).push({ item: l.item_name, qty: Number(l.quantity), unit_price: Number(l.unit_price), line_total: Number(l.line_total) });
  for (const l of orderLinesRes.data || []) (linesByRef[l.order_id] ||= []).push({ item: l.item_name, qty: Number(l.quantity), unit_price: Number(l.unit_price), line_total: Number(l.line_total) });
  for (const l of returnLinesRes.data || []) (linesByRef[l.return_id] ||= []).push({ item: l.item_name, qty: Number(l.qty), unit_price: Number(l.unit_price), line_total: round2(Number(l.qty) * Number(l.unit_price)) });

  let charged = 0;
  let paid = 0;
  let running = 0;
  const entries = ledger.map((l) => {
    const amount = round2(l.amount);
    const lines = linesByRef[l.reference_id] || [];
    const kind = l.direction === "charge" ? "charge" : l.direction === "payment" ? "payment" : l.reference_type === "sale_return" ? "return" : "adjustment";
    if (kind === "charge") charged += amount;
    else paid += amount;
    running = round2(running + (kind === "charge" ? amount : -amount));

    let label;
    if (kind === "payment") label = "Payment received";
    else if (kind === "return") label = "Items returned";
    else if (kind === "adjustment") label = l.note || "Adjustment";
    else if (l.reference_type === "counter_sale") label = "Sale";
    else if (l.reference_type === "dental_order") label = "Order from the doctor portal";
    else if (l.is_opening_balance || !l.reference_type) label = "Balance carried over from before the platform";
    else label = l.note || "Charge";

    // Anything the item prices do not account for (a discount, a delivery
    // charge) is its own line, so the items always add up to the amount.
    const itemsTotal = round2(lines.reduce((s, x) => s + x.line_total, 0));
    const difference = lines.length && (kind === "charge" || kind === "return") ? round2(amount - itemsTotal) : 0;

    return {
      id: l.id,
      date: l.entry_date,
      brand: l.brand,
      kind,
      label,
      receipt_no: receiptBySale[l.reference_id] || l.receipt_no || null,
      payment_method: kind === "payment" ? l.payment_method : null,
      reference_type: l.reference_type,
      reference_id: l.reference_id,
      note: l.note && label !== l.note ? l.note : null,
      amount,
      lines,
      difference,
      running,
    };
  });

  return { entries, totals: { charged: round2(charged), paid: round2(paid), balance: round2(charged - paid) } };
}
