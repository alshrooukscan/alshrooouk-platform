"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";
import ScanInsights from "../../components/analytics/ScanInsights";
import DoctorAnalytics from "../../components/analytics/DoctorAnalytics";
import HRAnalytics from "../../components/analytics/HRAnalytics";
import StockAnalytics from "../../components/analytics/StockAnalytics";
import DrillDownModal from "../../components/analytics/DrillDownModal";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "scans", label: "Scans" },
  { key: "doctors", label: "Doctors" },
  { key: "hr", label: "HR" },
  { key: "stock", label: "Stock" },
];

export default function DashboardHome() {
  return (
    <Suspense fallback={<p style={{ color: theme.gray }}>Loading...</p>}>
      <DashboardTabs />
    </Suspense>
  );
}

function DashboardTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "overview";

  function setTab(key) {
    router.push(key === "overview" ? "/dashboard" : `/dashboard?tab=${key}`);
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Dashboard &amp; Analytics</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>Everything measurable in the system, in one place.</p>

      <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "none",
              background: tab === t.key ? theme.navy : "#fff",
              color: tab === t.key ? "#fff" : theme.navy,
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 13,
              boxShadow: "0 2px 8px rgba(39,33,77,0.06)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview />}
      {tab === "scans" && <ScanInsights />}
      {tab === "doctors" && <DoctorAnalytics />}
      {tab === "hr" && <HRAnalytics />}
      {tab === "stock" && <StockAnalytics />}
    </div>
  );
}

function Overview() {
  const [ledger, setLedger] = useState([]);
  const [dentalUnits, setDentalUnits] = useState(0);
  const [el3awamaUnits, setEl3awamaUnits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

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

  async function openRevenueDrill(streamLabel) {
    setDrill({ title: `${streamLabel} — Revenue`, subtitle: "Loading real transactions...", columns: [], rows: [] });
    setDrillLoading(true);
    if (streamLabel === "Scans") {
      const { data } = await supabase
        .from("visits")
        .select("exam_date, amount_paid, payment_method, patients(name)")
        .gt("amount_paid", 0)
        .order("exam_date", { ascending: false })
        .limit(200);
      setDrill({
        title: "Scans — Recent Revenue",
        subtitle: `Most recent 200 of the visits behind this figure`,
        columns: [
          { key: "patient", label: "Patient", render: (r) => r.patients?.name || "—" },
          { key: "amount_paid", label: "Amount Paid (EGP)" },
          { key: "payment_method", label: "Method" },
          { key: "exam_date", label: "Date" },
        ],
        rows: data || [],
      });
    } else {
      setDrill({
        title: `${streamLabel} — Revenue`,
        subtitle: "No transactions recorded through the system yet for this stream.",
        columns: [],
        rows: [],
      });
    }
    setDrillLoading(false);
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
  const cashOutSuppliers = sum("suppliers", "out");

  const totalCashIn = cashInScans + cashInEl3awama + cashInStock;
  const totalCashOut = cashOutEl3awama + cashOutStock + cashOutScans + cashOutPayroll + cashOutSuppliers;
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
    { label: "Supplier payments (Purchase Orders)", value: cashOutSuppliers },
  ].filter((e) => e.value > 0);

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  return (
    <div>
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
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 8 }}>Click a bar to see the real transactions behind it.</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revenueStreams} onClick={(e) => { if (e && e.activePayload) openRevenueDrill(e.activePayload[0].payload.label); }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${formatMoney(v)} EGP`, "Revenue"]} cursor={{ fill: "rgba(39,33,77,0.05)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} style={{ cursor: "pointer" }}>
                {revenueStreams.map((r, i) => (
                  <Cell key={i} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 12, paddingTop: 16, borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between" }}>
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
        {(cashInEl3awama === 0 || cashInStock === 0) && " Stock and El3awama show 0 in Cash In because no sale has been recorded through the system yet, current quantities were loaded as opening stock, not as sales history. The first real sale through Stock → Transaction will start reflecting here."}
      </p>

      {drill && (
        <DrillDownModal
          title={drill.title}
          subtitle={drill.subtitle}
          columns={drill.columns}
          rows={drill.rows}
          loading={drillLoading}
          onClose={() => setDrill(null)}
        />
      )}
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
