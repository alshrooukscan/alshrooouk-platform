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
import PeriodFilterBar, { getDateRange } from "../../components/analytics/PeriodFilterBar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Cell as PieCell, Legend } from "recharts";

const PAYMENT_COLORS = ["#27214D", "#A98B4D", "#6D5A3A", "#8a7ba0", "#c9a86a", "#48464E", "#3d3564"];

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
  const [allLedger, setAllLedger] = useState([]);
  const [allPaymentRows, setAllPaymentRows] = useState([]);
  const [dentalUnits, setDentalUnits] = useState(0);
  const [el3awamaUnits, setEl3awamaUnits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [filter, setFilter] = useState({ year: "", quarter: "", month: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    let all = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase.from("cash_ledger").select("source_stream, direction, amount, entry_date").range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // Real revenue by payment method, sourced from actual visits, not the ledger
    // (the ledger tracks stream/direction, not how the customer actually paid).
    // Kept with exam_date so it can be re-filtered by the period selector below.
    let paymentRows = [];
    let pfrom = 0;
    while (true) {
      const { data } = await supabase.from("visits").select("payment_method, amount_paid, exam_date").gt("amount_paid", 0).range(pfrom, pfrom + pageSize - 1);
      if (!data || data.length === 0) break;
      paymentRows = paymentRows.concat(data);
      if (data.length < pageSize) break;
      pfrom += pageSize;
    }
    setAllPaymentRows(paymentRows);

    // Real supplier payments (actual cash out), pulled in as a synthetic 'suppliers' stream.
    const { data: poPayments } = await supabase.from("purchase_orders").select("amount, entry_date").eq("entry_type", "payment");
    const supplierRows = (poPayments || []).map((p) => ({ source_stream: "suppliers", direction: "out", amount: Math.abs(Number(p.amount)), entry_date: p.entry_date }));

    const { data: items } = await supabase.from("stock_items").select("category, qty_remaining");
    setAllLedger(all.concat(supplierRows));
    setDentalUnits((items || []).filter((i) => i.category === "dental").reduce((s, i) => s + (i.qty_remaining || 0), 0));
    setEl3awamaUnits((items || []).filter((i) => i.category === "el3awama").reduce((s, i) => s + (i.qty_remaining || 0), 0));
    setLoading(false);
  }

  const years = [...new Set(allLedger.filter((l) => l.entry_date).map((l) => l.entry_date.slice(0, 4)))].sort().reverse();
  const { start, end } = getDateRange(filter);
  const ledger = start ? allLedger.filter((l) => l.entry_date && l.entry_date >= start && l.entry_date <= end) : allLedger;

  const filteredPaymentRows = start
    ? allPaymentRows.filter((r) => r.exam_date && r.exam_date >= start && r.exam_date <= end)
    : allPaymentRows;
  const byMethod = {};
  const KNOWN_METHODS = ["cash", "instapay", "vodafone cash", "visa", "wallet"];
  for (const row of filteredPaymentRows) {
    const raw = (row.payment_method || "").trim();
    const normalized = raw.toLowerCase();
    const method = KNOWN_METHODS.includes(normalized)
      ? raw.replace(/\b\w/g, (c) => c.toUpperCase())
      : raw
      ? "Other / Unrecognized"
      : "Unspecified";
    byMethod[method] = (byMethod[method] || 0) + Number(row.amount_paid || 0);
  }
  const paymentMethodTotals = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
  const paymentMethodTotalSum = paymentMethodTotals.reduce((s, [, v]) => s + v, 0);

  function sum(stream, direction) {
    return ledger.filter((l) => l.source_stream === stream && l.direction === direction).reduce((s, l) => s + Number(l.amount || 0), 0);
  }

  async function openRevenueDrill(streamLabel) {
    setDrill({ title: `${streamLabel} — Revenue`, subtitle: "Loading real transactions...", columns: [], rows: [] });
    setDrillLoading(true);
    if (streamLabel === "Scans") {
      let q = supabase.from("visits").select("exam_date, amount_paid, payment_method, patients(name)").gt("amount_paid", 0);
      if (start) q = q.gte("exam_date", start).lte("exam_date", end);
      const { data } = await q.order("exam_date", { ascending: false }).limit(200);
      setDrill({
        title: "Scans — Recent Revenue",
        subtitle: `Most recent 200 of the visits behind this figure${start ? " (within selected period)" : ""}`,
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
      <PeriodFilterBar years={years} year={filter.year} quarter={filter.quarter} month={filter.month} onChange={setFilter} />

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

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Revenue by Payment Method</h3>
        <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 16 }}>How customers actually paid, from real recorded visits{start ? ", within the selected period" : ""}.</p>
        {paymentMethodTotals.some(([m]) => m === "Other / Unrecognized") && (
          <p style={{ fontSize: 11, color: "#a97c00", marginTop: -10, marginBottom: 14, background: "#fff8e1", padding: "8px 12px", borderRadius: 8 }}>
            "Other / Unrecognized" mostly comes from older migrated visits where the original payment method wasn't cleanly recorded, it holds real notes text rather than a clean Cash/InstaPay/Visa/Wallet value.
          </p>
        )}
        {paymentMethodTotals.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>No payments recorded for this period.</p>}
        {paymentMethodTotals.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(paymentMethodTotals.length, 3)}, 1fr)`, gap: 14, alignContent: "start" }}>
              {paymentMethodTotals.map(([method, total], i) => (
                <div key={method} style={{ background: "#faf9fb", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: theme.gray, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: PAYMENT_COLORS[i % PAYMENT_COLORS.length], display: "inline-block" }} />
                    {method.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: theme.navy, marginTop: 4 }}>{formatMoney(total)} <span style={{ fontSize: 12, fontWeight: 500 }}>EGP</span></div>
                  <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>{paymentMethodTotalSum > 0 ? ((total / paymentMethodTotalSum) * 100).toFixed(1) : 0}%</div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={paymentMethodTotals.map(([method, total]) => ({ name: method, value: total }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {paymentMethodTotals.map((_, i) => (
                    <PieCell key={i} fill={PAYMENT_COLORS[i % PAYMENT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [`${formatMoney(v)} EGP`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
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
