"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";
import { usePermissions } from "../../lib/usePermissions";
import { useT, tx, Ltr, dateLocale } from "../../lib/i18n";
// Every tab was being downloaded before the first one could render - eight
// analytics bundles plus recharts, for a page where only one tab is ever on
// screen. Each now loads when its tab is opened. Same components, same
// behaviour, just not all at once.
const loading = () => <p style={{ color: theme.gray, padding: 20 }}>{tx("Loading...")}</p>;
const EXPENSE_LABEL = {
  rent: "Rent", utilities: "Utilities", maintenance: "Maintenance", supplies: "Supplies / misc purchases",
  courier: "Courier / rep cash", other: "Other expenses",
};
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
import { useAutoRefresh, useLiveStatus } from "../../lib/useAutoRefresh";
import { fetchAll, cairoDate, fetchStockCashIn, fetchStockProfit, brandStream } from "../../lib/dashboardData";

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
  const { t } = useT();
  return (
    <Suspense fallback={<p style={{ color: theme.gray }}>{t("Loading...")}</p>}>
      <DashboardTabs />
    </Suspense>
  );
}

// Shows that the numbers are live: green while the change feed is connected,
// with the time of the last refresh. Any sale, payment, PO or clock-in updates
// the open tab within a second or two; it also refreshes every minute and when
// the tab comes back into view.
function LiveBadge() {
  const { t } = useT();
  const { connected, lastUpdated } = useLiveStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  const time = lastUpdated ? lastUpdated.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Cairo" }) : "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: "#fff", boxShadow: "0 2px 8px rgba(39,33,77,0.06)", fontSize: 12, color: theme.navy, marginTop: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: connected ? "#2e7d32" : "#c9a86a", display: "inline-block", boxShadow: connected ? "0 0 0 3px rgba(46,125,50,0.15)" : "none" }} />
      <strong>{connected ? t("Live") : t("Auto-refresh")}</strong>
      {time && <span style={{ color: theme.gray }}>{t("updated {time}", { time })}</span>}
    </div>
  );
}

function DashboardTabs() {
  const { t: tr } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "overview";

  function setTab(key) {
    router.push(key === "overview" ? "/dashboard" : `/dashboard?tab=${key}`);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ color: theme.navy, marginBottom: 4 }}>{tr("Dashboard & Analytics")}</h1>
          <p style={{ color: theme.gray, marginBottom: 20 }}>{tr("Everything measurable in the system, in one place.")}</p>
        </div>
        <LiveBadge />
      </div>

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
            {tr(t.label)}
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
  const { t, isAr } = useT();
  const { isAdmin, profile } = usePermissions();
  useAutoRefresh(["visit_payments", "visits", "counter_sales", "customer_ar_ledger", "expense_transactions", "purchase_orders", "stock_items", "stock_batches"], () => load());
  const [allLedger, setAllLedger] = useState([]);
  const [allPaymentRows, setAllPaymentRows] = useState([]);
  const [dentalUnits, setDentalUnits] = useState(0);
  const [el3awamaUnits, setEl3awamaUnits] = useState(0);
  const [consolidatedSupplier, setConsolidatedSupplier] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  // Revenue by payment method, for one business line or all (30 Oct 2026).
  const [methodLine, setMethodLine] = useState("all");
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



  // Live-numbers audit (23 Oct 2026): this page read cash_ledger, which only
  // the pre-launch tables (invoices, stock_transactions, cash_expenses,
  // payroll_runs) ever wrote to. October scans showed 4,440 against a real
  // 104,900, dental stock money was missing entirely and a 23,500 "payroll"
  // line came from deleted test runs. Every figure now comes from the tables
  // the live flows actually write, dated on the day the money moved (Cairo).
  async function load() {
    try {
      const [payments, stockIn, expenses, poPayments, items, payslips, stockProfit] = await Promise.all([
        fetchAll(() => supabase.from("visit_payments").select("id, payment_method, amount, paid_at, visits(exam_date, patients(name))")),
        fetchStockCashIn(),
        fetchAll(() =>
          supabase
            .from("expense_transactions")
            .select("id, amount, category, note, entry_date, created_by_name, brand")
            .eq("status", "confirmed")
            .eq("type", "cash_out")
            .or("category.is.null,category.neq.supplier_payment")
        ),
        fetchAll(() => supabase.from("purchase_orders").select("id, amount, entry_date, payment_method, is_consolidated, suppliers(name)").eq("entry_type", "payment").eq("status", "active")),
        fetchAll(() => supabase.from("stock_items").select("id, category, qty_remaining")),
        // Salaries: every issued payslip (30 Oct 2026, actual net profit).
        fetchAll(() => supabase.from("payroll_runs").select("id, period, net_total, deductions, generated_at, employees(name)")),
        fetchStockProfit(),
      ]);

      const rows = [];
      for (const p of payments) {
        rows.push({ source_stream: "scans", direction: "in", amount: Number(p.amount || 0), entry_date: cairoDate(p.paid_at), method: p.payment_method, who: p.visits?.patients?.name || "", kind: "Visit payment" });
      }
      // Stock counts as PROFIT, not money taken in (Mohamed Said, 4 Nov
      // 2026): sale price minus purchase price on every item sold. So stock
      // bought from suppliers is not deducted below either; it reaches the
      // P&L as the cost inside that profit when the item is sold.
      for (const r of stockProfit) {
        rows.push({ source_stream: brandStream(r.brand), direction: "in", amount: r.amount, entry_date: r.entry_date, method: null, who: r.ref || "", kind: r.kind, sales: r.sales, cost: r.cost });
      }
      for (const e of expenses) {
        // Cash handed back to a customer on a return reduces stock money in;
        // it is not an operating expense.
        if (e.category === "customer_refund") {
          // the return already took its margin off stock profit
          continue;
        } else {
          rows.push({ source_stream: "expenses", direction: "out", amount: Number(e.amount || 0), entry_date: e.entry_date, who: e.note || e.category || "", kind: e.category || "other" });
        }
      }
      // The consolidated payment (31 Aug) settles all pre-launch purchases in
      // one line; there is no matching stock revenue before launch, so it
      // would sink any period it falls in. It is shown on its own, not in P&L.
      let consolidated = 0;
      for (const po of poPayments) {
        if (po.is_consolidated) { consolidated += Math.abs(Number(po.amount || 0)); continue; }
        rows.push({ source_stream: "suppliers", direction: "out", amount: Math.abs(Number(po.amount || 0)), entry_date: po.entry_date, method: po.payment_method, who: po.suppliers?.name || "", kind: "Supplier payment" });
      }
      // What a payslip costs is what the person earned: the net paid plus the
      // parts settled out of it (an advance repaid, a staff tab, cash swept).
      // Those were money the business had already handed over, so taking them
      // off the net would undercount the salary. Dated on the last day of the
      // pay month, which is the month the salary belongs to.
      for (const r of payslips || []) {
        const settled = (Array.isArray(r.deductions) ? r.deductions : [])
          .filter((d) => ["advance", "tab", "cash"].includes(d.source))
          .reduce((t, d) => t + Number(d.amount || 0), 0);
        const per = String(r.period || "").slice(0, 7);
        const [y, m] = per.split("-").map(Number);
        const monthEnd = y && m ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : cairoDate(r.generated_at);
        rows.push({ source_stream: "salaries", direction: "out", amount: Number(r.net_total || 0) + settled, entry_date: monthEnd, who: r.employees?.name || "", kind: "Salary" });
      }
      setConsolidatedSupplier(consolidated);
      setAllLedger(rows);
      // The payment-method charts are about money received, so they keep the
      // cash actually taken for stock, not the profit.
      setAllPaymentRows([
        ...rows.filter((r) => r.source_stream === "scans" && r.direction === "in" && r.amount > 0),
        ...stockIn.map((r) => ({ source_stream: brandStream(r.brand), amount: r.amount, entry_date: r.entry_date, method: r.method })).filter((r) => r.amount > 0),
      ].map((r) => ({ payment_method: r.method, amount_paid: r.amount, exam_date: r.entry_date, stream: r.source_stream })));
      setDentalUnits(items.filter((i) => i.category === "dental").reduce((s, i) => s + Number(i.qty_remaining || 0), 0));
      setEl3awamaUnits(items.filter((i) => i.category === "el3awama").reduce((s, i) => s + Number(i.qty_remaining || 0), 0));
    } finally {
      setLoading(false);
    }
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
  // The migration wrote the literal string "Unknown" for visits whose original
  // method wasn't captured. Naming that honestly beats calling it
  // "Unrecognized", which implies a parsing failure we could still fix.
  const normMethod = (rawIn) => {
    const raw = (rawIn || "").trim();
    const key = raw.toLowerCase();
    return METHOD_LABELS[key] || (key === "unknown" ? "Not recorded (migrated)" : raw ? raw : "Unspecified");
  };
  // Every method across all lines, so a method keeps one colour everywhere.
  const methodOrder = Object.entries(
    filteredPaymentRows.reduce((acc, r) => { const m = normMethod(r.payment_method); acc[m] = (acc[m] || 0) + Number(r.amount_paid || 0); return acc; }, {})
  ).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  const methodColor = (m) => PAYMENT_COLORS[Math.max(methodOrder.indexOf(m), 0) % PAYMENT_COLORS.length];
  // Business line x method, for the stacked revenue bars and the table.
  const lineMethod = { scans: {}, el3awama: {}, stock: {} };
  for (const r of filteredPaymentRows) {
    const line = lineMethod[r.stream] ? r.stream : null;
    if (!line) continue;
    const m = normMethod(r.payment_method);
    lineMethod[line][m] = (lineMethod[line][m] || 0) + Number(r.amount_paid || 0);
  }
  const byMethod = {};
  const byMethodCount = {};
  for (const row of filteredPaymentRows) {
    if (methodLine !== "all" && row.stream !== methodLine) continue;
    const method = normMethod(row.payment_method);
    byMethod[method] = (byMethod[method] || 0) + Number(row.amount_paid || 0);
    byMethodCount[method] = (byMethodCount[method] || 0) + 1;
  }
  const paymentMethodTotals = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
  const migratedCount = byMethodCount["Not recorded (migrated)"] || 0;
  const paymentMethodTotalSum = paymentMethodTotals.reduce((s, [, v]) => s + v, 0);

  function sum(stream, direction) {
    return ledger.filter((l) => l.source_stream === stream && l.direction === direction).reduce((s, l) => s + Number(l.amount || 0), 0);
  }

  // The rows behind a bar are the same rows that make up the bar.
  function openRevenueDrill(streamLabel) {
    const stream = { Scans: "scans", El3awama: "el3awama", Stock: "stock" }[streamLabel];
    const rows = ledger
      .filter((l) => l.source_stream === stream && l.direction === "in")
      .sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
    if (stream !== "scans") {
      // Stock lines are profit per item sold (4 Nov 2026).
      setDrill({
        title: t("{stream}: profit on items sold", { stream: t(streamLabel) }),
        subtitle: t("{n} payments, {amount} EGP", { n: rows.length.toLocaleString(), amount: formatMoney(rows.reduce((s, r) => s + r.amount, 0)) }) + (start ? t(" in the selected period") : "") + (rows.length > 300 ? t(" (latest 300 shown)") : ""),
        columns: [
          { key: "entry_date", label: t("Date") },
          { key: "kind", label: t("Type"), render: (r) => t(r.kind) },
          { key: "who", label: t("Item") },
          { key: "sales", label: t("Sale price"), render: (r) => formatMoney(r.sales, { decimals: 2 }) },
          { key: "cost", label: t("Purchase price"), render: (r) => formatMoney(r.cost, { decimals: 2 }) },
          { key: "amount", label: t("Stock profit"), render: (r) => formatMoney(r.amount, { decimals: 2 }) },
        ],
        rows: rows.slice(0, 300),
      });
      return;
    }
    setDrill({
      title: t("{stream}: money received", { stream: t(streamLabel) }),
      subtitle: t("{n} payments, {amount} EGP", { n: rows.length.toLocaleString(), amount: formatMoney(rows.reduce((s, r) => s + r.amount, 0)) }) + (start ? t(" in the selected period") : "") + (rows.length > 300 ? t(" (latest 300 shown)") : ""),
      columns: [
        { key: "entry_date", label: t("Date") },
        { key: "kind", label: t("Type"), render: (r) => t(r.kind) },
        { key: "who", label: stream === "scans" ? t("Patient") : t("Receipt") },
        { key: "method", label: t("Method"), render: (r) => (isAr ? t(normMethod(r.method)) : r.method) },
        { key: "amount", label: t("Amount (EGP)"), render: (r) => formatMoney(r.amount, { decimals: 2 }) },
      ],
      rows: rows.slice(0, 300),
    });
  }

  const cashInScans = sum("scans", "in");
  const cashInEl3awama = sum("el3awama", "in");
  const cashInStock = sum("stock", "in");
  const cashOutEl3awama = sum("el3awama", "out");
  const cashOutStock = sum("stock", "out");
  const cashOutScans = sum("scans", "out");
  const cashOutSuppliers = sum("suppliers", "out");
  const cashOutExpenses = sum("expenses", "out");
  const cashOutSalaries = sum("salaries", "out");

  const totalCashIn = cashInScans + cashInEl3awama + cashInStock;
  // Supplier payments buy stock; stock is counted through its profit, so they
  // are shown but not deducted (4 Nov 2026).
  const totalCashOut = cashOutScans + cashOutExpenses + cashOutSalaries;
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
    { label: "Stock bought (counted through stock profit, not deducted)", value: cashOutSuppliers, info: true },
    { label: "Salaries (issued payslips)", value: cashOutSalaries },
    // Every expense category on its own line, so rent, utilities and the rest
    // can each be read (30 Oct 2026).
    ...Object.entries(
      ledger.filter((l) => l.source_stream === "expenses" && l.direction === "out")
        .reduce((acc, l) => { const k = EXPENSE_LABEL[l.kind] || (l.kind ? l.kind.replace(/_/g, " ") : "Other"); acc[k] = (acc[k] || 0) + Number(l.amount || 0); return acc; }, {})
    ).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
  ].filter((e) => e.value > 0);

  if (loading) return <p style={{ color: theme.gray }}>{t("Loading...")}</p>;

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
        <KpiCard label={t("Cash In: Scans")} value={cashInScans} />
        <KpiCard label={t("El3awama profit")} value={cashInEl3awama} />
        <KpiCard label={t("Stock profit (sale price minus purchase price)")} value={cashInStock} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <KpiCard label={t("Total Cash Out")} value={totalCashOut} negative />
        <KpiCard label={t("Net P&L")} value={netPL} highlight />
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <div style={{ fontSize: 12, color: theme.gray, fontWeight: 600 }}>{t("STOCK CAPACITY")}</div>
          <div style={{ fontSize: 13, color: theme.navy, marginTop: 8 }}>{t("Dental:")} <strong>{dentalUnits}</strong> {t("units")}</div>
          <div style={{ fontSize: 13, color: theme.navy }}>{t("El3awama:")} <strong>{el3awamaUnits}</strong> {t("units")}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Revenue by Stream")}</h3>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 8 }}>{t("Click a bar to see the real transactions behind it.")}</p>
          <ResponsiveContainer width="100%" height={250}>
            {/* Each business line split by how it was paid (30 Oct 2026). */}
            <BarChart data={revenueStreams.map((r) => ({ label: r.label, ...lineMethod[{ Scans: "scans", El3awama: "el3awama", Stock: "stock" }[r.label]] }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickFormatter={(v) => t(v)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, n) => [t("{amount} EGP", { amount: formatMoney(v) }), n]} labelFormatter={(l) => t(l)} cursor={{ fill: "rgba(39,33,77,0.05)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {methodOrder.map((m, i) => (
                <Bar key={m} dataKey={m} name={t(m)} stackId="rev" fill={methodColor(m)} style={{ cursor: "pointer" }}
                  radius={i === methodOrder.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                  onClick={(d) => d?.label && openRevenueDrill(d.label)} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 12, paddingTop: 16, borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, color: theme.navy }}>{t("Total Revenue")}</span>
            <span style={{ fontWeight: 700, color: theme.navy }}>{t("{amount} EGP", { amount: formatMoney(totalCashIn) })}</span>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Expenses Overview")}</h3>
          {expenses.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>{t("No expenses recorded yet.")}</p>}
          {expenses.map((e) => (
            <div key={e.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}>
              <span style={{ color: theme.navy }}>{t(e.label)}</span>
              <span style={{ color: e.info ? theme.gray : "#ba1a1a", fontWeight: 600 }}>{t("{amount} EGP", { amount: formatMoney(e.value) })}</span>
            </div>
          ))}
          {expenses.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 4px", fontSize: 14, fontWeight: 800 }}>
                <span style={{ color: theme.navy }}>{t("Total expenses")}</span>
                <span style={{ color: "#ba1a1a" }}>{t("{amount} EGP", { amount: formatMoney(totalCashOut) })}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14, fontWeight: 800 }}>
                <span style={{ color: theme.navy }}>{t("Net profit")}</span>
                <span style={{ color: netPL >= 0 ? "#1e7a3c" : "#ba1a1a" }}>{t("{amount} EGP", { amount: formatMoney(netPL) })}</span>
              </div>
              <p style={{ fontSize: 11, color: theme.gray, margin: "6px 0 0" }}>
                {t("Salaries count from issued payslips only. Salaries paid outside the system (September) are not included.")}
              </p>
            </>
          )}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Revenue by Payment Method")}</h3>
        <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 12 }}>{t("How customers actually paid")}{methodLine === "all" ? t(", all business lines together") : ""}{start ? t(", within the selected period") : ""}.</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {[["all", "All business lines"], ["scans", "Scans"], ["el3awama", "El3awama"], ["stock", "Dental Stock"]].map(([k, l]) => (
            <button key={k} onClick={() => setMethodLine(k)}
              style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                       border: `1px solid ${methodLine === k ? theme.navy : "#ddd"}`, background: methodLine === k ? theme.navy : "#fff", color: methodLine === k ? "#fff" : theme.navy }}>
              {t(l)}
            </button>
          ))}
        </div>
        {methodOrder.length > 0 && (
          <div style={{ overflowX: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "start", padding: "6px 8px", color: theme.gray, fontSize: 11, borderBottom: "1px solid #eee" }}>{t("BUSINESS LINE")}</th>
                  {methodOrder.map((m) => <th key={m} style={{ textAlign: "end", padding: "6px 8px", color: theme.gray, fontSize: 11, borderBottom: "1px solid #eee" }}>{t(m).toUpperCase()}</th>)}
                  <th style={{ textAlign: "end", padding: "6px 8px", color: theme.gray, fontSize: 11, borderBottom: "1px solid #eee" }}>{t("TOTAL")}</th>
                </tr>
              </thead>
              <tbody>
                {[["scans", "Scans"], ["el3awama", "El3awama"], ["stock", "Dental Stock"]].map(([k, l]) => {
                  const row = lineMethod[k]; const tot = Object.values(row).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={k} onClick={() => setMethodLine(k)} style={{ cursor: "pointer", background: methodLine === k ? "#faf7ef" : "transparent" }}>
                      <td style={{ padding: "7px 8px", fontWeight: 700, color: theme.navy, borderBottom: "1px solid #f5f5f5" }}>{t(l)}</td>
                      {methodOrder.map((m) => <td key={m} style={{ padding: "7px 8px", textAlign: "end", color: theme.navy, borderBottom: "1px solid #f5f5f5" }}>{row[m] ? formatMoney(row[m]) : "-"}</td>)}
                      <td style={{ padding: "7px 8px", textAlign: "end", fontWeight: 800, color: theme.navy, borderBottom: "1px solid #f5f5f5" }}>{formatMoney(tot)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {paymentMethodTotals.some(([m]) => m === "Not recorded (migrated)") && (
          <p style={{ fontSize: 11, color: "#a97c00", marginTop: -10, marginBottom: 14, background: "#fff8e1", padding: "8px 12px", borderRadius: 8 }}>
            {t("\"Not recorded (migrated)\" covers {n} payments brought over from the original Excel files, every one of them dated before September 2026. The method was stored there literally as \"Unknown\", was never captured at the time, and cannot be recovered from the source. It is not a reporting fault. Every payment taken in the platform since go-live carries its real method.", { n: migratedCount.toLocaleString() })}
          </p>
        )}
        {paymentMethodTotals.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>{t("No payments recorded for this period.")}</p>}
        {paymentMethodTotals.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(paymentMethodTotals.length, 3)}, 1fr)`, gap: 14, alignContent: "start" }}>
              {paymentMethodTotals.map(([method, total], i) => (
                <div key={method} style={{ background: "#faf9fb", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: theme.gray, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: methodColor(method), display: "inline-block" }} />
                    {t(method).toUpperCase()}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: theme.navy, marginTop: 4 }}>{formatMoney(total)} <span style={{ fontSize: 12, fontWeight: 500 }}>{t("EGP")}</span></div>
                  <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>{paymentMethodTotalSum > 0 ? ((total / paymentMethodTotalSum) * 100).toFixed(1) : 0}%</div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={paymentMethodTotals.map(([method, total]) => ({ name: t(method), value: total }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {paymentMethodTotals.map(([m], i) => (
                    <PieCell key={i} fill={methodColor(m)} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [t("{amount} EGP", { amount: formatMoney(v) }), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <p style={{ fontSize: 11, color: "#999", marginTop: 20 }}>
        {t("Money in: scan visit payments, dental stock paid at the counter and collected on account. Money out: confirmed cash expenses by category (rent, utilities and the rest), supplier payments and salaries from issued payslips. All dated on the day the money moved.")}
        {consolidatedSupplier > 0 && " " + t("The one-off settlement of {amount} EGP for supplier purchases before launch (31 Aug 2026) is kept out of these totals.", { amount: formatMoney(consolidatedSupplier) })}
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
  const { t } = useT();
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
        {formatMoney(value)} <span style={{ fontSize: 14, fontWeight: 500 }}>{t("EGP")}</span>
      </div>
    </div>
  );
}
