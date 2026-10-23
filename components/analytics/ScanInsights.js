"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import DrillDownModal from "./DrillDownModal";
import PeriodFilterBar, { getDateRange } from "./PeriodFilterBar";
import { fetchAll, cairoToday } from "../../lib/dashboardData";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = [theme.navy, theme.gold, "#6D5A3A", "#A98B4D", "#48464E", "#8a7ba0", "#c9a86a", "#3d3564"];

// A couple of legacy visits carry impossible exam dates (1956, 1960). They are
// still real visits, but they are kept out of anything plotted by date.
const MIN_EXAM_DATE = "2020-01-01";
const hasRealDate = (v) => !!v.exam_date && v.exam_date >= MIN_EXAM_DATE;

// "YYYY-MM" keys from startKey to endKey inclusive, pure string math so the
// browser's timezone can never shift a month.
function monthKeys(startKey, endKey) {
  const out = [];
  let y = parseInt(startKey.slice(0, 4), 10);
  let m = parseInt(startKey.slice(5, 7), 10);
  const ey = parseInt(endKey.slice(0, 4), 10);
  const em = parseInt(endKey.slice(5, 7), 10);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Scan types are typed by hand, so "Endo One Tooth" and "Endo one tooth" must
// count as one. Groups case-insensitively and shows the most common spelling.
function buildScanNamer(visits) {
  const spellings = {};
  for (const v of visits) {
    for (const t of v.scan_types || []) {
      if (typeof t !== "string" || !t.trim()) continue;
      const k = t.trim().toLowerCase();
      const s = (spellings[k] = spellings[k] || {});
      s[t.trim()] = (s[t.trim()] || 0) + 1;
    }
  }
  const display = {};
  for (const [k, s] of Object.entries(spellings)) display[k] = Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
  return (t) => (typeof t === "string" && t.trim() ? display[t.trim().toLowerCase()] || t.trim() : null);
}

export default function ScanInsights() {
  const [allVisits, setAllVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [filter, setFilter] = useState({ year: "", quarter: "", month: "" });
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  useAutoRefresh(["visits", "doctors", "branches"], load);

  // Silent on refresh: "Loading" only shows until the first load completes.
  async function load() {
    try {
      const all = await fetchAll(() =>
        supabase
          .from("visits")
          .select("id, scan_types, exam_date, branch_id, payment_status, patient_id, patients(name), doctors(name), branches(name)")
      );
      setAllVisits(all);
      setError(null);
    } catch (e) {
      setError(e.message || "Could not load scan data.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (error && allVisits.length === 0) return <p style={{ color: "#ba1a1a" }}>Could not load scan data: {error}</p>;

  const scanName = buildScanNamer(allVisits);
  const years = [...new Set(allVisits.filter(hasRealDate).map((v) => v.exam_date.slice(0, 4)))].sort().reverse();
  const { start, end } = getDateRange(filter);
  const visits = start ? allVisits.filter((v) => v.exam_date && v.exam_date >= start && v.exam_date <= end) : allVisits;

  const totalScans = visits.reduce((s, v) => s + (v.scan_types?.length || 0), 0);
  const totalVisits = visits.length;

  const typeCounts = {};
  for (const v of visits) {
    for (const t of v.scan_types || []) {
      const n = scanName(t);
      if (n) typeCounts[n] = (typeCounts[n] || 0) + 1;
    }
  }
  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

  // A specific year/quarter/month selected: show that range by month.
  // No filter: the last 12 months up to the current Cairo month.
  let monthKeyList;
  if (start) {
    monthKeyList = monthKeys(start.slice(0, 7), end.slice(0, 7));
  } else {
    const endKey = cairoToday().slice(0, 7);
    let y = parseInt(endKey.slice(0, 4), 10);
    let m = parseInt(endKey.slice(5, 7), 10) - 11;
    if (m < 1) { m += 12; y--; }
    monthKeyList = monthKeys(`${y}-${String(m).padStart(2, "0")}`, endKey);
  }
  const monthData = monthKeyList.map((key) => ({ month: key.slice(5) + "/" + key.slice(2, 4), key, scans: 0 }));
  const bucketByKey = Object.fromEntries(monthData.map((m) => [m.key, m]));
  for (const v of visits) {
    if (!hasRealDate(v)) continue;
    const bucket = bucketByKey[v.exam_date.slice(0, 7)];
    if (bucket) bucket.scans += v.scan_types?.length || 0;
  }

  const paidCount = visits.filter((v) => v.payment_status === "paid").length;
  const paidRate = totalVisits > 0 ? ((paidCount / totalVisits) * 100).toFixed(0) : 0;

  const branchCounts = {};
  for (const v of visits) {
    const bname = v.branches?.name || "Unassigned";
    branchCounts[bname] = (branchCounts[bname] || 0) + 1;
  }

  function openScanTypeDrill(typeName) {
    const rows = visits
      .filter((v) => (v.scan_types || []).some((t) => scanName(t) === typeName))
      .map((v) => ({ patient: v.patients?.name || "—", doctor: v.doctors?.name || "Walk-in", date: v.exam_date, status: v.payment_status }));
    setDrill({
      title: typeName,
      subtitle: `${rows.length} visit${rows.length === 1 ? "" : "s"} included this scan type`,
      columns: [
        { key: "patient", label: "Patient" },
        { key: "doctor", label: "Doctor" },
        { key: "date", label: "Date" },
        { key: "status", label: "Payment" },
      ],
      rows,
    });
  }

  function openMonthDrill(monthLabel, key) {
    const rows = visits
      .filter((v) => hasRealDate(v) && v.exam_date.startsWith(key))
      .map((v) => ({ patient: v.patients?.name || "—", scans: (v.scan_types || []).join(", "), date: v.exam_date, status: v.payment_status }));
    setDrill({
      title: `Visits in ${monthLabel}`,
      subtitle: `${rows.length} visit${rows.length === 1 ? "" : "s"}`,
      columns: [
        { key: "patient", label: "Patient" },
        { key: "scans", label: "Scan Types" },
        { key: "date", label: "Date" },
        { key: "status", label: "Payment" },
      ],
      rows,
    });
  }

  return (
    <div>
      <PeriodFilterBar years={years} year={filter.year} quarter={filter.quarter} month={filter.month} day={filter.day} onChange={setFilter} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Scans" value={totalScans.toLocaleString()} />
        <StatCard label="Total Visits" value={totalVisits.toLocaleString()} />
        <StatCard label="Distinct Scan Types Used" value={Object.keys(typeCounts).length} />
        <StatCard label="Visits Paid in Full" value={`${paidRate}%`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{start ? "Scans by Month" : "Scans, Last 12 Months"}</h3>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 12 }}>Click a point to see that month's visits.</p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={monthData} onClick={(e) => { if (e && e.activePayload) openMonthDrill(e.activePayload[0].payload.month, e.activePayload[0].payload.key); }}>
              <defs>
                <linearGradient id="scanGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.gold} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={theme.gold} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [v, "Scans"]} cursor={{ fill: "rgba(169,139,77,0.08)" }} />
              <Area type="monotone" dataKey="scans" stroke={theme.navy} fill="url(#scanGradient)" strokeWidth={2} style={{ cursor: "pointer" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Top Scan Types</h3>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 12 }}>Click a bar to see the matching visits.</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topTypes} layout="vertical" margin={{ left: 10 }} onClick={(e) => { if (e && e.activePayload) openScanTypeDrill(e.activePayload[0].payload.name); }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
              <Tooltip cursor={{ fill: "rgba(39,33,77,0.05)" }} />
              <Bar dataKey="count" fill={theme.navy} radius={[0, 4, 4, 0]} style={{ cursor: "pointer" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Visits by Branch</h3>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={Object.entries(branchCounts).map(([name, count]) => ({ name, value: count }))}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={70}
              label
            >
              {Object.keys(branchCounts).map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {drill && (
        <DrillDownModal
          title={drill.title}
          subtitle={drill.subtitle}
          columns={drill.columns}
          rows={drill.rows}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ fontSize: 12, color: theme.gray, fontWeight: 600 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: theme.navy, marginTop: 6 }}>{value}</div>
    </div>
  );
}
