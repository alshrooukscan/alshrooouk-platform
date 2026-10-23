"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";
import DrillDownModal from "./DrillDownModal";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { fetchAll, cairoToday } from "../../lib/dashboardData";

// Money owed to the clinic, in one place. Revenue answers "what came in";
// this answers "what hasn't", which is the number that actually needs chasing
// and which the platform previously showed nowhere at all.
const AGE_BUCKETS = [
  { key: "0-30", label: "Under 30 days", min: 0, max: 30 },
  { key: "31-90", label: "31 to 90 days", min: 31, max: 90 },
  { key: "91-180", label: "91 to 180 days", min: 91, max: 180 },
  { key: "180+", label: "Over 180 days", min: 181, max: Infinity },
];

export default function OutstandingAnalytics() {
  const [visits, setVisits] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [tab, setTab] = useState("patients");

  useEffect(() => { load(); }, []);
  useAutoRefresh(["visits", "visit_payments", "customer_ar_ledger", "counter_sales"], () => load());

  // Live-numbers audit (23 Oct 2026): "owed by doctors" read dental_orders,
  // whose amount_paid is never updated by account payments, so it showed 460
  // (already settled) and missed the real 5,814.73 owed on clinic accounts.
  // It now reads the same account balances Debt Collection works from.
  async function load() {
    try {
      const [rows, balRes] = await Promise.all([
        fetchAll(() =>
          supabase
            .from("visits")
            .select("id, exam_date, amount_due, amount_paid, payment_status, scan_types, patients(id, name, mobile), doctors(name, clinic_code)")
            .neq("payment_status", "paid")
        ),
        supabase.from("customer_ar_balances").select("customer_type, customer_id, brand, balance").gt("balance", 0.005),
      ]);
      const bals = balRes.data || [];
      const clinicIds = bals.filter((b) => b.customer_type === "clinic").map((b) => b.customer_id);
      const doctorIds = bals.filter((b) => b.customer_type === "doctor").map((b) => b.customer_id);
      const [clinicsRes, doctorsRes] = await Promise.all([
        clinicIds.length ? supabase.from("clinics").select("id, name, code").in("id", clinicIds) : { data: [] },
        doctorIds.length ? supabase.from("doctors").select("id, name, clinic_code").in("id", doctorIds) : { data: [] },
      ]);
      const codes = (clinicsRes.data || []).map((c) => c.code).filter(Boolean);
      const { data: clinicDoctors } = codes.length ? await supabase.from("doctors").select("name, clinic_code").in("clinic_code", codes) : { data: [] };
      const clinicById = Object.fromEntries((clinicsRes.data || []).map((c) => [c.id, c]));
      const doctorById = Object.fromEntries((doctorsRes.data || []).map((d) => [d.id, d]));
      setVisits(rows);
      setOrders(
        bals
          .map((b) => {
            if (b.customer_type === "clinic") {
              const c = clinicById[b.customer_id] || {};
              const docs = (clinicDoctors || []).filter((d) => d.clinic_code === c.code).map((d) => d.name);
              return { id: `${b.customer_id}-${b.brand}`, customerId: b.customer_id, brand: b.brand, name: c.name && c.name !== "0" ? `${c.name} (${c.code})` : `Clinic ${c.code || ""}`, sub: docs.join(", "), owed: Number(b.balance) };
            }
            const d = doctorById[b.customer_id] || {};
            return { id: `${b.customer_id}-${b.brand}`, customerId: b.customer_id, brand: b.brand, name: d.name || "Doctor", sub: d.clinic_code ? `Clinic ${d.clinic_code}` : "", owed: Number(b.balance) };
          })
          .sort((x, y) => y.owed - x.owed)
      );
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const owedOn = (v) => Math.max(Number(v.amount_due || 0) - Number(v.amount_paid || 0), 0);
  const open = visits.filter((v) => owedOn(v) > 0.005);
  const today = new Date(cairoToday() + "T00:00:00");
  const ageOf = (d) => (d ? Math.floor((today - new Date(d + "T00:00:00")) / 86400000) : 0);

  const patientTotal = open.reduce((s, v) => s + owedOn(v), 0);
  const orderTotal = orders.reduce((s, o) => s + o.owed, 0);
  const money2 = (v) => formatMoney(v, { decimals: Math.round(Number(v || 0) * 100) % 100 ? 2 : 0 });

  const buckets = AGE_BUCKETS.map((b) => {
    const rows = open.filter((v) => {
      const a = ageOf(v.exam_date);
      return a >= b.min && a <= b.max;
    });
    return { ...b, rows, total: rows.reduce((s, v) => s + owedOn(v), 0) };
  });

  // Grouped by patient, because chasing is done per person, not per visit.
  const byPatient = {};
  for (const v of open) {
    const k = v.patients?.id || "unknown";
    if (!byPatient[k]) byPatient[k] = { name: v.patients?.name || "Unknown", mobile: v.patients?.mobile, owed: 0, visits: 0, oldest: null };
    byPatient[k].owed += owedOn(v);
    byPatient[k].visits++;
    const a = ageOf(v.exam_date);
    if (byPatient[k].oldest === null || a > byPatient[k].oldest) byPatient[k].oldest = a;
  }
  const debtors = Object.values(byPatient).sort((a, b) => b.owed - a.owed);

  const byClinic = {};
  for (const v of open) {
    const k = v.doctors?.clinic_code || "No referring doctor";
    byClinic[k] = (byClinic[k] || 0) + owedOn(v);
  }
  const clinics = Object.entries(byClinic).sort((a, b) => b[1] - a[1]).slice(0, 10);

  function openDrill(title, rows) {
    setDrill({
      title,
      subtitle: `${rows.length} visit${rows.length === 1 ? "" : "s"} · ${formatMoney(rows.reduce((s, v) => s + owedOn(v), 0))} EGP owed`,
      columns: [
        { key: "patient", label: "Patient" },
        { key: "mobile", label: "Mobile" },
        { key: "date", label: "Visit Date" },
        { key: "scan", label: "Scan" },
        { key: "owed", label: "Owed (EGP)" },
        { key: "age", label: "Days" },
      ],
      rows: rows
        .sort((a, b) => owedOn(b) - owedOn(a))
        .map((v) => ({
          patient: v.patients?.name || "-",
          mobile: v.patients?.mobile || "-",
          date: v.exam_date || "-",
          scan: (v.scan_types || []).join(", "),
          owed: formatMoney(owedOn(v)),
          age: ageOf(v.exam_date),
        })),
    });
  }

  const card = { background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Money Owed</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        Everything billed but not yet collected, from patient visits and clinic / doctor stock accounts.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        <button onClick={() => openDrill("All outstanding visits", open)} style={{ ...card, border: "none", textAlign: "left", cursor: "pointer" }}>
          <div style={{ fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Owed by patients</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: patientTotal > 0 ? "#ba1a1a" : theme.navy }}>{formatMoney(patientTotal)} EGP</div>
          <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>{open.length} unpaid or part-paid visits</div>
        </button>
        <div style={card}>
          <div style={{ fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Owed on stock accounts</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: orderTotal > 0 ? "#ba1a1a" : theme.navy }}>{money2(orderTotal)} EGP</div>
          <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>{orders.length} clinic / doctor account{orders.length === 1 ? "" : "s"}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Total outstanding</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: theme.navy }}>{money2(patientTotal + orderTotal)} EGP</div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 24 }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>How old is the debt?</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          Measured from the visit date. The older a balance, the less likely it is to be collected — click any band to see who is in it.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {buckets.map((b) => (
            <button key={b.key} onClick={() => openDrill(b.label, b.rows)}
              style={{ background: "#faf9fb", border: "none", borderRadius: 12, padding: 14, textAlign: "left", cursor: "pointer" }}>
              <div style={{ fontSize: 11, color: theme.gray, fontWeight: 700, marginBottom: 5 }}>{b.label}</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: b.min >= 91 ? "#ba1a1a" : theme.navy }}>{formatMoney(b.total)} EGP</div>
              <div style={{ fontSize: 11, color: theme.gray, marginTop: 3 }}>{b.rows.length} visits</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[{ k: "patients", l: "Patients who owe" }, { k: "clinics", l: "By clinic" }, { k: "doctors", l: "Stock accounts" }].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: tab === t.k ? theme.navy : "#fff", color: tab === t.k ? "#fff" : theme.navy,
              boxShadow: "0 2px 8px rgba(39,33,77,0.06)" }}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === "patients" && (
        <div style={card}>
          {debtors.length === 0 && <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>Nothing outstanding.</p>}
          {debtors.slice(0, 40).map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f2f2f2" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>{d.name}</div>
                <div style={{ fontSize: 11, color: theme.gray }}>
                  {d.mobile || "no number"} · {d.visits} visit{d.visits === 1 ? "" : "s"} · oldest {d.oldest} days
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#ba1a1a" }}>{formatMoney(d.owed)} EGP</span>
            </div>
          ))}
          {debtors.length > 40 && (
            <p style={{ fontSize: 12, color: theme.gray, marginBottom: 0 }}>Showing the 40 largest of {debtors.length}.</p>
          )}
        </div>
      )}

      {tab === "clinics" && (
        <div style={card}>
          {clinics.map(([code, amt]) => (
            <div key={code} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f2f2f2" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>{code}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#ba1a1a" }}>{formatMoney(amt)} EGP</span>
            </div>
          ))}
        </div>
      )}

      {tab === "doctors" && (
        <div style={card}>
          {orders.length === 0 && <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>No clinic or doctor owes anything on stock.</p>}
          {orders.map((o) => (
            <a key={o.id} href={`/dashboard/debt-collection/statement/${o.customerId}/${o.brand}`}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f2f2f2", textDecoration: "none" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>{o.name}</div>
                <div style={{ fontSize: 11, color: theme.gray }}>
                  {o.sub ? `${o.sub} · ` : ""}{o.brand === "dental_stock" ? "Dental stock" : o.brand} · open statement
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#ba1a1a" }}>{money2(o.owed)} EGP</span>
            </a>
          ))}
        </div>
      )}

      {drill && (
        <DrillDownModal title={drill.title} subtitle={drill.subtitle} columns={drill.columns} rows={drill.rows} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}
