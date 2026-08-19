"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import DrillDownModal from "./DrillDownModal";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = [theme.navy, theme.gold, "#6D5A3A", "#A98B4D", "#48464E", "#8a7ba0", "#c9a86a", "#3d3564"];

export default function ScanInsights() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    let all = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from("visits")
        .select("id, scan_types, exam_date, branch_id, payment_status, patient_id, patients(name), doctors(name), branches(name)")
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setVisits(all);
    setLoading(false);
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const totalScans = visits.reduce((s, v) => s + (v.scan_types?.length || 0), 0);
  const totalVisits = visits.length;

  const typeCounts = {};
  for (const v of visits) {
    for (const t of v.scan_types || []) typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

  const now = new Date();
  const monthKeys = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthData = monthKeys.map((key) => ({ month: key.slice(5) + "/" + key.slice(2, 4), key, scans: 0 }));
  for (const v of visits) {
    if (!v.exam_date) continue;
    const d = new Date(v.exam_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = monthData.find((m) => m.key === key);
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
      .filter((v) => (v.scan_types || []).includes(typeName))
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
      .filter((v) => v.exam_date && v.exam_date.startsWith(key))
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Scans" value={totalScans.toLocaleString()} />
        <StatCard label="Total Visits" value={totalVisits.toLocaleString()} />
        <StatCard label="Distinct Scan Types Used" value={Object.keys(typeCounts).length} />
        <StatCard label="Visits Paid in Full" value={`${paidRate}%`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Scans, Last 12 Months</h3>
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
