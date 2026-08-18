"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";

export default function DashboardHome() {
  const [ledger, setLedger] = useState([]);
  const [dentalUnits, setDentalUnits] = useState(0);
  const [el3awamaUnits, setEl3awamaUnits] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: summary } = await supabase.rpc("get_pl_summary");
    const { data: items } = await supabase.from("stock_items").select("category, qty_remaining");
    setLedger(summary || []);
    setDentalUnits((items || []).filter((i) => i.category === "dental").reduce((s, i) => s + (i.qty_remaining || 0), 0));
    setEl3awamaUnits((items || []).filter((i) => i.category === "el3awama").reduce((s, i) => s + (i.qty_remaining || 0), 0));
    setLoading(false);
  }

  function sum(stream, direction) {
    const row = ledger.find((l) => l.source_stream === stream && l.direction === direction);
    return row ? Number(row.total) : 0;
  }

  const cashInScans = sum("scans", "in");
  const cashInEl3awama = sum("el3awama", "in");
  const cashInStock = sum("stock", "in");
  const cashOutEl3awama = sum("el3awama", "out");
  const cashOutStock = sum("stock", "out");
  const cashOutScans = sum("scans", "out");
  const cashOutPayroll = sum("payroll", "out");

  const totalCashIn = cashInScans + cashInEl3awama + cashInStock;
  const totalCashOut = cashOutEl3awama + cashOutStock + cashOutScans + cashOutPayroll;
  const netPL = totalCashIn - totalCashOut;

  const revenueStreams = [
    { label: "Scans", value: cashInScans, color: theme.navy },
    { label: "El3awama", value: cashInEl3awama, color: theme.gold },
    { label: "Stock", value: cashInStock, color: theme.goldLight },
  ];
  const maxRevenue = Math.max(...revenueStreams.map((r) => r.value), 1);

  const expenses = [
    { label: "El3awama purchases", value: cashOutEl3awama },
    { label: "Stock purchases", value: cashOutStock },
    { label: "Scans-related costs", value: cashOutScans },
    { label: "Payroll", value: cashOutPayroll },
  ].filter((e) => e.value > 0);

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>P&amp;L Dashboard</h1>
      <p style={{ color: theme.gray, marginBottom: 24 }}>Executive summary &amp; financial performance, live from every transaction in the system.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
        <KpiCard label="Cash In: Scans" value={cashInScans} />
        <KpiCard label="Cash In: El3awama" value={cashInEl3awama} />
        <KpiCard label="Cash In: Stock" value={cashInStock} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <KpiCard label="Total Cash Out" value={totalCashOut} negative />
        <KpiCard label="Net P&L" value={netPL} highlight />
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <div style={{ fontSize: 12, color: theme.gray, fontWeight: 600 }}>STOCK CAPACITY</div>
          <div style={{ fontSize: 13, color: theme.navy, marginTop: 8 }}>Dental: <strong>{dentalUnits}</strong> units</div>
          <div style={{ fontSize: 13, color: theme.navy }}>El3awama: <strong>{el3awamaUnits}</strong> units</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Revenue by Stream</h3>
          {revenueStreams.map((r) => (
            <div key={r.label} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: theme.navy, fontWeight: 600 }}>{r.label}</span>
                <span style={{ color: theme.gray }}>{formatMoney(r.value)} EGP</span>
              </div>
              <div style={{ height: 10, background: "#f0f0f0", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(r.value / maxRevenue) * 100}%`, background: r.color, borderRadius: 6 }} />
              </div>
            </div>
          ))}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, color: theme.navy }}>Total Revenue</span>
            <span style={{ fontWeight: 700, color: theme.navy }}>{formatMoney(totalCashIn)} EGP</span>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Expenses Overview</h3>
          {expenses.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>No expenses recorded yet.</p>}
          {expenses.map((e) => (
            <div key={e.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}>
              <span style={{ color: theme.navy }}>{e.label}</span>
              <span style={{ color: "#ba1a1a", fontWeight: 600 }}>{formatMoney(e.value)} EGP</span>
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 11, color: "#bbb", marginTop: 20 }}>
        Every figure above reads live from the cash_ledger table, populated automatically when invoices, stock sales/purchases, or payroll runs happen anywhere in the system.
      </p>
    </div>
  );
}

function KpiCard({ label, value, negative, highlight }) {
  return (
    <div
      style={{
        background: highlight ? theme.navy : "#fff",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 4px 20px rgba(39,33,77,0.06)",
      }}
    >
      <div style={{ fontSize: 12, color: highlight ? theme.goldLight : theme.gray, fontWeight: 600 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: highlight ? "#fff" : negative ? "#ba1a1a" : theme.navy, marginTop: 6 }}>
        {formatMoney(value)} <span style={{ fontSize: 14, fontWeight: 500 }}>EGP</span>
      </div>
    </div>
  );
}
