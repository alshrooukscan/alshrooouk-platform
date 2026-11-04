"use client";
import { supabase } from "./supabase";

// Shared helpers for the analytics dashboard (live-numbers audit, 23 Oct 2026).

// Supabase returns at most 1,000 rows per request. Every dashboard read goes
// through this so a growing table can never be silently cut off. Ordered by id
// so pages stay stable while rows are being added.
export async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().order("id").range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// The business runs on Cairo time. A timestamp written at 01:00 Cairo is the
// previous day in UTC, so slicing the ISO string files it under the wrong day.
export function cairoDate(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

export function cairoToday() {
  return cairoDate(new Date());
}

// Money that actually came in for stock, by brand: counter sales paid on the
// spot (not "postponed", which goes on account) plus collections against an
// account. Returned as ledger-style rows.
export async function fetchStockCashIn() {
  const [sales, collections] = await Promise.all([
    fetchAll(() => supabase.from("counter_sales").select("id, brand, net_amount, payment_method, entry_date, receipt_no").neq("payment_method", "postponed")),
    fetchAll(() => supabase.from("customer_ar_ledger").select("id, brand, amount, payment_method, entry_date, receipt_no").eq("direction", "payment")),
  ]);
  return [
    ...sales.map((s) => ({ kind: "Paid at the counter", brand: s.brand, amount: Number(s.net_amount || 0), method: s.payment_method, entry_date: s.entry_date, ref: s.receipt_no })),
    ...collections.map((c) => ({ kind: "Collected on account", brand: c.brand, amount: Number(c.amount || 0), method: c.payment_method, entry_date: c.entry_date, ref: c.receipt_no })),
  ];
}

export const brandStream = (brand) => (brand === "el3awama_stock" || brand === "el3awama" ? "el3awama" : "stock");

// Stock profit (Mohamed Said, 4 Nov 2026): what the clinic makes on stock is
// the difference between what an item sold for and what it was bought for,
// not the money taken in. Every sale draws stock from a purchase batch, and
// stock_batch_consumption records each draw with its unit cost and unit sale
// price (FIFO), so the margin is exact per line. Only real sales count:
// counter sales and the imported pre-launch sales history. Stock counts,
// adjustments, voided POs and supplier returns move stock but sell nothing.
// An approved customer return takes its margin back, on the day decided.
export async function fetchStockProfit() {
  const [lines, items, returns, batches] = await Promise.all([
    fetchAll(() => supabase.from("stock_batch_consumption").select("id, stock_item_id, qty, unit_cost, unit_sale, entry_date, source_type").in("source_type", ["counter_sale", "import"])),
    fetchAll(() => supabase.from("stock_items").select("id, category, name")),
    fetchAll(() => supabase.from("sale_return_lines").select("id, stock_item_id, item_name, qty, unit_price, batch_id, sale_returns!inner(status, brand, decided_at, receipt_no)").eq("sale_returns.status", "approved")),
    fetchAll(() => supabase.from("stock_batches").select("id, purchase_price")),
  ]);
  const cat = new Map(items.map((i) => [i.id, i]));
  const cost = new Map(batches.map((b) => [b.id, Number(b.purchase_price || 0)]));
  const out = [];
  for (const l of lines) {
    if (!l.entry_date) continue;
    const it = cat.get(l.stock_item_id);
    const qty = Number(l.qty || 0);
    out.push({
      kind: "Sold", brand: it?.category === "el3awama" ? "el3awama_stock" : "dental_stock", entry_date: l.entry_date,
      sales: qty * Number(l.unit_sale || 0), cost: qty * Number(l.unit_cost || 0),
      amount: qty * (Number(l.unit_sale || 0) - Number(l.unit_cost || 0)), ref: it?.name || "",
    });
  }
  for (const r of returns) {
    const qty = Number(r.qty || 0);
    const sales = qty * Number(r.unit_price || 0);
    const c = qty * (cost.get(r.batch_id) ?? 0);
    out.push({
      kind: "Customer return", brand: r.sale_returns?.brand || "dental_stock", entry_date: cairoDate(r.sale_returns?.decided_at),
      sales: -sales, cost: -c, amount: -(sales - c), ref: r.item_name || r.sale_returns?.receipt_no || "",
    });
  }
  return out;
}
