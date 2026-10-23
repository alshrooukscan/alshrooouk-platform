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
