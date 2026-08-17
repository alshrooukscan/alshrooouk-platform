"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

export default function StockAnalyticsPage() {
  const [category, setCategory] = useState("dental");
  const [items, setItems] = useState([]);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [category]);

  async function load() {
    setLoading(true);
    const { data: itemRows } = await supabase.from("stock_items").select("id, name, item_code").eq("category", category);
    const ids = (itemRows || []).map((i) => i.id);
    const { data: txnRows } = ids.length
      ? await supabase.from("stock_transactions").select("*").in("item_id", ids)
      : { data: [] };
    setItems(itemRows || []);
    setTxns(txnRows || []);
    setLoading(false);
  }

  const rows = items.map((item) => {
    const itemTxns = txns.filter((t) => t.item_id === item.id);
    const purchases = itemTxns.filter((t) => t.type === "purchase");
    const sales = itemTxns.filter((t) => t.type === "sale");

    const totalPurchased = purchases.reduce((s, t) => s + Number(t.total || 0), 0);
    const totalSold = sales.reduce((s, t) => s + Number(t.total || 0), 0);
    const netProfit = totalSold - totalPurchased;

    const salesPaid = sales.reduce((s, t) => s + Number(t.amount_paid || 0), 0);
    const salesPending = totalSold - salesPaid;

    const purchasesPaid = purchases.reduce((s, t) => s + Number(t.amount_paid || 0), 0);
    const purchasesPending = totalPurchased - purchasesPaid;

    return { ...item, totalPurchased, totalSold, netProfit, salesPaid, salesPending, purchasesPaid, purchasesPending };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      totalPurchased: acc.totalPurchased + r.totalPurchased,
      totalSold: acc.totalSold + r.totalSold,
      netProfit: acc.netProfit + r.netProfit,
      salesPending: acc.salesPending + r.salesPending,
      purchasesPending: acc.purchasesPending + r.purchasesPending,
    }),
    { totalPurchased: 0, totalSold: 0, netProfit: 0, salesPending: 0, purchasesPending: 0 }
  );

  return (
    <div>
      <p style={{ color: theme.gray, fontSize: 13, marginBottom: 8 }}>
        <a href="/dashboard/stock" style={{ color: theme.gray }}>Stock</a> &gt; Analytics
      </p>
      <h1 style={{ color: theme.navy, marginBottom: 20 }}>Stock Analytics</h1>

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        <KpiCard label="Total Purchased" value={totals.totalPurchased} />
        <KpiCard label="Total Sold" value={totals.totalSold} />
        <KpiCard label="Net Profit" value={totals.netProfit} highlight />
        <KpiCard label="Sales Still Pending" value={totals.salesPending} warn />
        <KpiCard label="Owed to Suppliers" value={totals.purchasesPending} warn />
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}

      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#faf9fb", textAlign: "left" }}>
              <Th>Item</Th>
              <Th>Purchased</Th>
              <Th>Sold</Th>
              <Th>Net Profit</Th>
              <Th>Customer Owes You</Th>
              <Th>You Owe Supplier</Th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.totalPurchased > 0 || r.totalSold > 0)
              .sort((a, b) => b.netProfit - a.netProfit)
              .map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <Td><strong>{r.name}</strong> <span style={{ color: theme.gray }}>({r.item_code})</span></Td>
                  <Td>{r.totalPurchased.toFixed(0)} EGP</Td>
                  <Td>{r.totalSold.toFixed(0)} EGP</Td>
                  <Td style={{ color: r.netProfit >= 0 ? "#2e7d32" : "#ba1a1a", fontWeight: 700 }}>{r.netProfit.toFixed(0)} EGP</Td>
                  <Td style={{ color: r.salesPending > 0 ? "#a97c00" : theme.gray }}>{r.salesPending > 0 ? `${r.salesPending.toFixed(0)} EGP` : "—"}</Td>
                  <Td style={{ color: r.purchasesPending > 0 ? "#ba1a1a" : theme.gray }}>{r.purchasesPending > 0 ? `${r.purchasesPending.toFixed(0)} EGP` : "—"}</Td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && rows.filter((r) => r.totalPurchased > 0 || r.totalSold > 0).length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: theme.gray }}>No transactions recorded yet for this category.</div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, highlight, warn }) {
  return (
    <div style={{ background: highlight ? theme.navy : "#fff", borderRadius: 14, padding: 16, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ fontSize: 10, color: highlight ? theme.goldLight : theme.gray, fontWeight: 700 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? "#fff" : warn && value > 0 ? "#a97c00" : theme.navy, marginTop: 4 }}>
        {value.toFixed(0)} <span style={{ fontSize: 11, fontWeight: 500 }}>EGP</span>
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
