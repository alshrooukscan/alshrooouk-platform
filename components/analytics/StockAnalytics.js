"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";
import { exportToCsv } from "../../lib/exportCsv";
import PeriodFilterBar, { getDateRange } from "./PeriodFilterBar";

export default function StockAnalytics() {
  const [category, setCategory] = useState("dental");
  const [items, setItems] = useState([]);
  const [allTxns, setAllTxns] = useState([]);
  const [supplierOwed, setSupplierOwed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState({ year: "", quarter: "", month: "" });

  useEffect(() => {
    load();
  }, [category]);

  async function load() {
    setLoading(true);
    const { data: itemRows } = await supabase.from("stock_items").select("id, name, item_code, purchase_price, sale_price, qty_remaining").eq("category", category);
    const ids = (itemRows || []).map((i) => i.id);
    const { data: txnRows } = ids.length
      ? await supabase.from("stock_transactions").select("*").in("item_id", ids)
      : { data: [] };
    const { data: balances } = await supabase.rpc("get_supplier_balances");
    setItems(itemRows || []);
    setAllTxns(txnRows || []);
    setSupplierOwed((balances || []).reduce((s, b) => s + Math.max(0, Number(b.balance)), 0));
    setLoading(false);
  }

  const years = [...new Set(allTxns.filter((t) => t.transaction_date).map((t) => t.transaction_date.slice(0, 4)))].sort().reverse();
  const { start, end } = getDateRange(dateFilter);
  const txns = start ? allTxns.filter((t) => t.transaction_date && t.transaction_date >= start && t.transaction_date <= end) : allTxns;

  const rows = items.map((item) => {
    const itemTxns = txns.filter((t) => t.item_id === item.id);
    const purchases = itemTxns.filter((t) => t.type === "purchase");
    const sales = itemTxns.filter((t) => t.type === "sale");

    const totalPurchased = purchases.reduce((s, t) => s + Number(t.total || 0), 0);
    const totalSold = sales.reduce((s, t) => s + Number(t.total || 0), 0);
    const txnProfit = totalSold - totalPurchased;

    const salesPaid = sales.reduce((s, t) => s + Number(t.amount_paid || 0), 0);
    const salesPending = totalSold - salesPaid;

    const qty = Number(item.qty_remaining) || 0;
    const inventoryCost = qty * Number(item.purchase_price || 0);
    const inventoryPotentialRevenue = qty * Number(item.sale_price || 0);
    const inventoryPotentialProfit = inventoryPotentialRevenue - inventoryCost;

    return { ...item, totalPurchased, totalSold, txnProfit, salesPending, qty, inventoryCost, inventoryPotentialRevenue, inventoryPotentialProfit };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      inventoryCost: acc.inventoryCost + r.inventoryCost,
      inventoryPotentialRevenue: acc.inventoryPotentialRevenue + r.inventoryPotentialRevenue,
      inventoryPotentialProfit: acc.inventoryPotentialProfit + r.inventoryPotentialProfit,
      totalPurchased: acc.totalPurchased + r.totalPurchased,
      totalSold: acc.totalSold + r.totalSold,
      lowStock: acc.lowStock + (r.qty <= 5 ? 1 : 0),
    }),
    { inventoryCost: 0, inventoryPotentialRevenue: 0, inventoryPotentialProfit: 0, totalPurchased: 0, totalSold: 0, lowStock: 0 }
  );

  const hasAnyTransactions = rows.some((r) => r.totalPurchased > 0 || r.totalSold > 0);

  function handleExport() {
    exportToCsv(`stock-${category}.csv`, rows.map((r) => ({
      Item: r.name,
      Code: r.item_code,
      "Qty Remaining": r.qty,
      "Purchase Price": r.purchase_price,
      "Sale Price": r.sale_price,
      "Inventory Cost": r.inventoryCost.toFixed(2),
      "Potential Revenue": r.inventoryPotentialRevenue.toFixed(2),
      "Potential Profit": r.inventoryPotentialProfit.toFixed(2),
    })));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ color: theme.navy, margin: 0 }}>Stock Analytics</h1>
        <button onClick={handleExport} style={exportBtn}>Export CSV</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["dental", "el3awama"].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            style={{
              padding: "10px 20px", borderRadius: 8, border: "none",
              background: category === c ? theme.navy : "#fff", color: category === c ? "#fff" : theme.navy,
              fontWeight: 700, cursor: "pointer", fontSize: 13, boxShadow: "0 2px 8px rgba(39,33,77,0.06)",
            }}
          >
            {c === "dental" ? "Dental Stock" : "El3awama Stock"}
          </button>
        ))}
      </div>

      <PeriodFilterBar years={years} year={dateFilter.year} quarter={dateFilter.quarter} month={dateFilter.month} day={dateFilter.day} onChange={setDateFilter} />

      <p style={{ fontSize: 12, color: theme.gray, marginTop: -10, marginBottom: 16 }}>
        Inventory value below always reflects current stock on hand (real quantities × real prices), the period filter above applies only to Recorded Purchases/Sales, which are transaction history, not a point-in-time snapshot.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
        <KpiCard label="Inventory Cost (on hand)" value={totals.inventoryCost} />
        <KpiCard label="Potential Revenue (on hand)" value={totals.inventoryPotentialRevenue} />
        <KpiCard label="Potential Profit (on hand)" value={totals.inventoryPotentialProfit} highlight />
        <KpiCard label="Low Stock Items (≤5)" value={totals.lowStock} isCount warn={totals.lowStock > 0} />
        <KpiCard label="Owed to Suppliers (all)" value={supplierOwed} warn={supplierOwed > 0} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 }}>
        <KpiCard label="Recorded Purchases (transactions)" value={totals.totalPurchased} small />
        <KpiCard label="Recorded Sales (transactions)" value={totals.totalSold} small />
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}

      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#faf9fb", textAlign: "left" }}>
              <Th>Item</Th>
              <Th>Qty on Hand</Th>
              <Th>Inventory Cost</Th>
              <Th>Potential Revenue</Th>
              <Th>Potential Profit</Th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.qty > 0)
              .sort((a, b) => b.inventoryPotentialProfit - a.inventoryPotentialProfit)
              .map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <Td><strong>{r.name}</strong> <span style={{ color: theme.gray }}>({r.item_code})</span></Td>
                  <Td>{r.qty}</Td>
                  <Td>{formatMoney(r.inventoryCost)} EGP</Td>
                  <Td>{formatMoney(r.inventoryPotentialRevenue)} EGP</Td>
                  <Td style={{ color: r.inventoryPotentialProfit >= 0 ? "#2e7d32" : "#ba1a1a", fontWeight: 700 }}>{formatMoney(r.inventoryPotentialProfit)} EGP</Td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && rows.filter((r) => r.qty > 0).length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: theme.gray }}>No stock on hand for this category.</div>
        )}
      </div>

      {!hasAnyTransactions && (
        <p style={{ fontSize: 11, color: "#bbb", marginTop: 12 }}>
          No purchase or sale transactions have been recorded through the system yet, that activity will appear here once staff use Stock → Transaction.
        </p>
      )}
    </div>
  );
}

function KpiCard({ label, value, highlight, warn, isCount, small }) {
  return (
    <div style={{ background: highlight ? theme.navy : "#fff", borderRadius: 14, padding: small ? 12 : 16, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ fontSize: 10, color: highlight ? theme.goldLight : theme.gray, fontWeight: 700 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: small ? 15 : 18, fontWeight: 700, color: highlight ? "#fff" : warn && value > 0 ? "#a97c00" : theme.navy, marginTop: 4 }}>
        {isCount ? value : <>{formatMoney(value)} <span style={{ fontSize: 11, fontWeight: 500 }}>EGP</span></>}
      </div>
    </div>
  );
}
function Th({ children }) {
  return <th style={{ padding: "10px 14px", fontSize: 10, color: "#48464E", fontWeight: 700, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: "10px 14px", color: "#27214D", ...style }}>{children}</td>;
}

const exportBtn = { padding: "8px 16px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer", fontSize: 12 };
