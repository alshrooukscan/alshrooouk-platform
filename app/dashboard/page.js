"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";
import { usePermissions } from "../../lib/usePermissions";
// Every tab was being downloaded before the first one could render - eight
// analytics bundles plus recharts, for a page where only one tab is ever on
// screen. Each now loads when its tab is opened. Same components, same
// behaviour, just not all at once.
const loading = () => <p style={{ color: theme.gray, padding: 20 }}>Loading...</p>;
const ScanInsights = dynamic(() => import("../../components/analytics/ScanInsights"), { loading });
const DoctorAnalytics = dynamic(() => import("../../components/analytics/DoctorAnalytics"), { loading });
const ClientRequestsAnalytics = dynamic(() => import("../../components/analytics/ClientRequestsAnalytics"), { loading });
const OutstandingAnalytics = dynamic(() => import("../../components/analytics/OutstandingAnalytics"), { loading });
const TrendsAnalytics = dynamic(() => import("../../components/analytics/TrendsAnalytics"), { loading });
const StockAlerts = dynamic(() => import("../../components/analytics/StockAlerts"), { loading });
const HRAnalytics = dynamic(() => import("../../components/analytics/HRAnalytics"), { loading });
const StockAnalytics = dynamic(() => import("../../components/analytics/StockAnalytics"), { loading });
import DrillDownModal from "../../components/analytics/DrillDownModal";
import PeriodFilterBar, { getDateRange } from "../../components/analytics/PeriodFilterBar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Cell as PieCell, Legend } from "recharts";
import { useAutoRefresh } from "../../lib/useAutoRefresh";

const PAYMENT_COLORS = ["#27214D", "#A98B4D", "#6D5A3A", "#8a7ba0", "#c9a86a", "#48464E", "#3d3564"];

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "trends", label: "Trends" },
  { key: "outstanding", label: "Money Owed" },
  { key: "scans", label: "Scans" },
  { key: "doctors", label: "Doctors" },
  { key: "requests", label: "Client Requests" },
  { key: "hr", label: "HR" },
  { key: "stock", label: "Stock" },
  { key: "stockalerts", label: "Stock Alerts" },
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
      {tab === "outstanding" && <OutstandingAnalytics />}
      {tab === "trends" && <TrendsAnalytics />}
      {tab === "stockalerts" && <StockAlerts />}
      {tab === "scans" && <ScanInsights />}
      {tab === "doctors" && <DoctorAnalytics />}
      {tab === "requests" && <ClientRequestsAnalytics />}
      {tab === "hr" && <HRAnalytics />}
      {tab === "stock" && <StockAnalytics />}
    </div>
  );
}

function Overview() {
  const { isAdmin, profile } = usePermissions();
  useAutoRefresh(["visits", "invoices", "reports", "cash_expenses", "expense_transactions"], () => { load(); });
  const [allLedger, setAllLedger] = useState([]);
  const [allPaymentRows, setAllPaymentRows] = useState([]);
  const [dentalUnits, setDentalUnits] = useState(0);
  const [el3awamaUnits, setEl3awamaUnits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [filter, setFilter] = useState({ year: "", quarter: "", month: "" });

  const BRANDS = [
    { key: "scan", label: "Scan" },
    { key: "dental_stock", label: "Dental Stock" },
    { key: "el3awama_stock", label: "El3awama Stock" },
  ];

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

    // Revenue by payment method comes from visit_payments, the actual payment
    // ledger - NOT visits.payment_method. The visit row only carries a single
    // denormalized method, so a split payment (part cash, part Visa) collapses
    // to one label and the other half disappears. Reading the ledger is also
    // the only way InstaPay/Wallet entries show up at all.
    let paymentRows = [];
    let pfrom = 0;
    while (true) {
      const { data } = await supabase
        .from("visit_payments")
        .select("visit_id, payment_method, amount, paid_at, visits(exam_date)")
        .range(pfrom, pfrom + pageSize - 1);
      if (!data || data.length === 0) break;
      paymentRows = paymentRows.concat(
        data.map((r) => ({
          payment_method: r.payment_method,
          amount_paid: r.amount,
          // Fall back to paid_at where a payment has no parent visit date, so
          // the period filter never silently drops real money.
          exam_date: r.visits?.exam_date || (r.paid_at ? r.paid_at.slice(0, 10) : null),
        }))
      );
      if (data.length < pageSize) break;
      pfrom += pageSize;
    }

    // A handful of older visits carry amount_paid without any matching ledger
    // row. Folding them in keeps this chart's total equal to real revenue
    // instead of quietly under-reporting by whatever those visits are worth.
    let orphanFrom = 0;
    const ledgerVisitIds = new Set();
    while (true) {
      const { data } = await supabase.from("visit_payments").select("visit_id").range(orphanFrom, orphanFrom + pageSize - 1);
      if (!data || data.length === 0) break;
      for (const r of data) ledgerVisitIds.add(r.visit_id);
      if (data.length < pageSize) break;
      orphanFrom += pageSize;
    }
    let vfrom = 0;
    while (true) {
      const { data } = await supabase.from("visits").select("id, payment_method, amount_paid, exam_date").gt("amount_paid", 0).range(vfrom, vfrom + pageSize - 1);
      if (!data || data.length === 0) break;
      for (const v of data) {
        if (!ledgerVisitIds.has(v.id)) {
          paymentRows.push({ payment_method: v.payment_method, amount_paid: v.amount_paid, exam_date: v.exam_date });
        }
      }
      if (data.length < pageSize) break;
      vfrom += pageSize;
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
  // Two vocabularies exist in the data: the visit forms historically wrote
  // "Cash"/"InstaPay"/"Wallet"/"Visa", while the expense and stock modules
  // write "cash"/"instapay"/"vodafone_cash". Both are mapped to one label here
  // so a method never splits into two slices.
  //
  // "Wallet" is the canonical name for mobile-wallet payments. Vodafone Cash is
  // one wallet among several (Orange Cash, Etisalat Cash), so it is folded into
  // Wallet rather than given its own slice - the client confirmed they mean the
  // same thing, and splitting them would divide identical payments in two.
  const METHOD_LABELS = {
    cash: "Cash",
    instapay: "InstaPay",
    "insta pay": "InstaPay",
    wallet: "Wallet",
    wallets: "Wallet",
    "mobile wallet": "Wallet",
    vodafone_cash: "Wallet",
    "vodafone cash": "Wallet",
    vodafonecash: "Wallet",
    visa: "Visa",
    card: "Visa",
  };
  const byMethod = {};
  const byMethodCount = {};
  for (const row of filteredPaymentRows) {
    const raw = (row.payment_method || "").trim();
    const key = raw.toLowerCase();
    // The migration wrote the literal string "Unknown" for visits whose original
    // method wasn't captured. Naming that honestly beats calling it
    // "Unrecognized", which implies a parsing failure we could still fix.
    const method =
      METHOD_LABELS[key] ||
      (key === "unknown" ? "Not recorded (migrated)" : raw ? raw : "Unspecified");
    byMethod[method] = (byMethod[method] || 0) + Number(row.amount_paid || 0);
    byMethodCount[method] = (byMethodCount[method] || 0) + 1;
  }
  const paymentMethodTotals = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
  const migratedCount = byMethodCount["Not recorded (migrated)"] || 0;
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
  const cashOutExpenses = sum("expenses", "out");

  const totalCashIn = cashInScans + cashInEl3awama + cashInStock;
  const totalCashOut = cashOutEl3awama + cashOutStock + cashOutScans + cashOutPayroll + cashOutSuppliers + cashOutExpenses;
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
    { label: "Cash Expenses (Utilities, Maintenance, Advances, etc.)", value: cashOutExpenses },
  ].filter((e) => e.value > 0);

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  return (
    <div>
      {/* Today's Cash Reconciliation was removed from the overview: cash now
          has its own pages per business - Scan Cash, Dental Stock Cash,
          El3awama Stock Cash, plus Cash Monitor - which show who is holding
          what and every movement behind it. Keeping a second, shallower
          version here meant two places to read the same figure, and the one
          on this page could not be acted on. */}

      <PeriodFilterBar years={years} year={filter.year} quarter={filter.quarter} month={filter.month} day={filter.day} onChange={setFilter} />

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
        {paymentMethodTotals.some(([m]) => m === "Not recorded (migrated)") && (
          <p style={{ fontSize: 11, color: "#a97c00", marginTop: -10, marginBottom: 14, background: "#fff8e1", padding: "8px 12px", borderRadius: 8 }}>
            "Not recorded (migrated)" covers {migratedCount.toLocaleString()} payments brought over from the original Excel files, every one of them dated before September 2026. The method was stored there literally as "Unknown", was never captured at the time, and cannot be recovered from the source. It is not a reporting fault. Every payment taken in the platform since go-live carries its real method.
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
