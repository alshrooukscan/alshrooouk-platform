"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";

// Direction, not a snapshot. Every other panel answers "what did this period
// look like"; nothing answered "is it getting better or worse", which is the
// question a business actually runs on.
export default function TrendsAnalytics() {
  const [visits, setVisits] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(12);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const pageSize = 1000;
    let rows = [];
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("visits")
        .select("exam_date, amount_due, amount_paid, scan_types, doctor_id, patient_id")
        .not("exam_date", "is", null)
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      rows = rows.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    const { data: ex } = await supabase
      .from("expense_transactions")
      .select("entry_date, type, brand, amount")
      .eq("status", "confirmed");
    setVisits(rows);
    setExpenses(ex || []);
    setLoading(false);
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const key = (d) => String(d).slice(0, 7);
  const now = new Date();
  const wanted = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    wanted.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const byMonth = {};
  for (const m of wanted) byMonth[m] = { visits: 0, revenue: 0, patients: new Set(), doctors: new Set(), cashOut: 0 };
  for (const v of visits) {
    const m = key(v.exam_date);
    if (!byMonth[m]) continue;
    byMonth[m].visits++;
    byMonth[m].revenue += Number(v.amount_paid || 0);
    if (v.patient_id) byMonth[m].patients.add(v.patient_id);
    if (v.doctor_id) byMonth[m].doctors.add(v.doctor_id);
  }
  // Outgoings, so revenue can be read against what it cost to earn it.
  for (const e of expenses) {
    const m = key(e.entry_date);
    if (!byMonth[m]) continue;
    if (["cash_out", "stock_purchase", "purchase"].includes(e.type)) byMonth[m].cashOut += Number(e.amount || 0);
  }

  const rows = wanted.map((m) => {
    const b = byMonth[m];
    return {
      month: m,
      label: new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      visits: b.visits,
      revenue: b.revenue,
      patients: b.patients.size,
      doctors: b.doctors.size,
      cashOut: b.cashOut,
      perVisit: b.visits ? b.revenue / b.visits : 0,
    };
  });

  // The current month is still running, so comparing it like a finished month
  // would always look like a collapse. Trend is measured on complete months.
  const complete = rows.slice(0, -1);
  const last = complete[complete.length - 1];
  const prev = complete[complete.length - 2];
  const delta = (a, b) => (b ? ((a - b) / b) * 100 : null);

  const maxRev = Math.max(...rows.map((r) => r.revenue), 1);
  const maxVisits = Math.max(...rows.map((r) => r.visits), 1);

  const card = { background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };

  const Kpi = ({ label, value, change, suffix }) => (
    <div style={card}>
      <div style={{ fontSize: 10, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: theme.navy }}>{value}{suffix}</div>
      {change !== null && change !== undefined && (
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, color: change >= 0 ? "#1e7a3c" : "#ba1a1a" }}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(0)}% vs previous month
        </div>
      )}
    </div>
  );

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Trends</h1>
      <p style={{ color: theme.gray, marginBottom: 16 }}>
        Month by month, so you can see direction rather than a single period in isolation.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {[6, 12, 24].map((m) => (
          <button key={m} onClick={() => setMonths(m)}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: months === m ? theme.navy : "#fff", color: months === m ? "#fff" : theme.navy,
              boxShadow: "0 2px 8px rgba(39,33,77,0.06)" }}>Last {m} months</button>
        ))}
      </div>

      {last && prev && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
          <Kpi label={`Revenue — ${last.label}`} value={formatMoney(last.revenue)} suffix=" EGP" change={delta(last.revenue, prev.revenue)} />
          <Kpi label={`Visits — ${last.label}`} value={last.visits} change={delta(last.visits, prev.visits)} />
          <Kpi label="Average per visit" value={formatMoney(last.perVisit)} suffix=" EGP" change={delta(last.perVisit, prev.perVisit)} />
          <Kpi label="Referring doctors" value={last.doctors} change={delta(last.doctors, prev.doctors)} />
        </div>
      )}

      <div style={{ ...card, marginBottom: 20 }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Revenue by month</h3>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 190, marginTop: 14 }}>
          {rows.map((r, i) => (
            <div key={r.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
              <div style={{ fontSize: 9, color: theme.gray, marginBottom: 3, whiteSpace: "nowrap" }}>
                {r.revenue > 0 ? formatMoney(Math.round(r.revenue / 1000)) + "k" : ""}
              </div>
              <div
                title={`${r.label}: ${formatMoney(r.revenue)} EGP from ${r.visits} visits`}
                style={{
                  width: "100%",
                  height: `${Math.max((r.revenue / maxRev) * 100, 1)}%`,
                  background: i === rows.length - 1 ? theme.gold : theme.navy,
                  borderRadius: "4px 4px 0 0",
                }}
              />
              <div style={{ fontSize: 9, color: theme.gray, marginTop: 5, whiteSpace: "nowrap" }}>{r.label}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: theme.gray, marginBottom: 0, marginTop: 10 }}>
          The final bar is the month in progress, so it is not comparable yet. Anything before 2026 was reconstructed from the
          migrated records rather than recorded at the counter.
        </p>
      </div>

      <div style={{ ...card, marginBottom: 20 }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Visits by month</h3>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130, marginTop: 14 }}>
          {rows.map((r) => (
            <div key={r.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
              <div title={`${r.label}: ${r.visits} visits, ${r.patients} patients`}
                style={{ width: "100%", height: `${Math.max((r.visits / maxVisits) * 100, 1)}%`, background: theme.gold, borderRadius: "4px 4px 0 0" }} />
              <div style={{ fontSize: 9, color: theme.gray, marginTop: 5 }}>{r.visits}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>The numbers</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#faf9fb" }}>
                {["Month", "Visits", "Patients", "Doctors", "Revenue", "Avg / visit", "Cash out"].map((h) => (
                  <th key={h} style={{ textAlign: h === "Month" ? "left" : "right", padding: "8px 10px", color: theme.navy, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.month} style={{ borderBottom: "1px solid #f2f2f2" }}>
                  <td style={{ padding: "8px 10px", color: theme.navy, fontWeight: 600 }}>{r.label}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.visits}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.patients}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.doctors}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: theme.navy }}>{formatMoney(r.revenue)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{formatMoney(r.perVisit)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: r.cashOut ? "#ba1a1a" : theme.gray }}>{formatMoney(r.cashOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
