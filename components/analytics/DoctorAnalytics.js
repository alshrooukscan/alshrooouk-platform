"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import DrillDownModal from "./DrillDownModal";
import PeriodFilterBar, { getDateRange } from "./PeriodFilterBar";

const PERIODS = {
  month: { label: "Month", days: 30 },
  quarter: { label: "Quarter", days: 90 },
  half: { label: "Half Year", days: 182 },
  year: { label: "Year", days: 365 },
};

export default function DoctorAnalytics() {
  const [period, setPeriod] = useState("quarter");
  const [doctors, setDoctors] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [dateFilter, setDateFilter] = useState({ year: "", quarter: "", month: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: docs } = await supabase.from("doctors").select("id, name, clinic_code");
    const { data: v } = await supabase.from("visits").select("doctor_id, exam_date, scan_types, patients(name)").not("doctor_id", "is", null);
    setDoctors(docs || []);
    setVisits(v || []);
    setLoading(false);
  }

  function openMonthDrill(monthLabel, key) {
    const docById = Object.fromEntries(doctors.map((d) => [d.id, d.name]));
    const rows = visits
      .filter((v) => v.exam_date && v.exam_date.startsWith(key))
      .map((v) => ({ doctor: docById[v.doctor_id] || "—", patient: v.patients?.name || "—", date: v.exam_date, scans: (v.scan_types || []).join(", ") }));
    setDrill({
      title: `Referrals in ${monthLabel}`,
      subtitle: `${rows.length} referral${rows.length === 1 ? "" : "s"}`,
      columns: [
        { key: "doctor", label: "Doctor" },
        { key: "patient", label: "Patient" },
        { key: "scans", label: "Scan Types" },
        { key: "date", label: "Date" },
      ],
      rows,
    });
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const now = new Date();
  const periodDays = PERIODS[period].days;
  const periodStart = new Date(now.getTime() - periodDays * 86400000);

  const periodVisits = visits.filter((v) => v.exam_date && new Date(v.exam_date) >= periodStart);
  const countByDoctor = {};
  for (const v of periodVisits) {
    countByDoctor[v.doctor_id] = (countByDoctor[v.doctor_id] || 0) + 1;
  }

  const buckets = { low: 0, mid: 0, high: 0 };
  const docIdsWithAnyHistory = new Set(visits.map((v) => v.doctor_id));
  for (const docId of docIdsWithAnyHistory) {
    const c = countByDoctor[docId] || 0;
    if (c < 2) buckets.low++;
    else if (c <= 4) buckets.mid++;
    else buckets.high++;
  }
  const bucketTotal = buckets.low + buckets.mid + buckets.high || 1;

  // Dormant: doctors with real history but nothing in the last 60 days, fixed threshold
  // regardless of the period selector above, since "gone quiet" is inherently a recency check.
  const dormantCutoff = new Date(now.getTime() - 60 * 86400000);
  const lastVisitByDoctor = {};
  for (const v of visits) {
    if (!v.exam_date) continue;
    const d = new Date(v.exam_date);
    if (!lastVisitByDoctor[v.doctor_id] || d > lastVisitByDoctor[v.doctor_id]) {
      lastVisitByDoctor[v.doctor_id] = d;
    }
  }
  const dormant = doctors
    .filter((d) => lastVisitByDoctor[d.id] && lastVisitByDoctor[d.id] < dormantCutoff)
    .map((d) => ({ ...d, lastVisit: lastVisitByDoctor[d.id], totalHistorical: visits.filter((v) => v.doctor_id === d.id).length }))
    .sort((a, b) => a.lastVisit - b.lastVisit);

  // Referral trend: full available range by default, or the selected calendar period
  const years = [...new Set(visits.filter((v) => v.exam_date).map((v) => v.exam_date.slice(0, 4)))].sort().reverse();
  const { start: filterStart, end: filterEnd } = getDateRange(dateFilter);
  const monthBuckets = {};
  if (filterStart) {
    let cursor = new Date(filterStart);
    const endDate = new Date(filterEnd);
    while (cursor <= endDate) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      monthBuckets[key] = 0;
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const datedVisits = visits.filter((v) => v.exam_date);
    if (datedVisits.length > 0) {
      const minDate = new Date(Math.min(...datedVisits.map((v) => new Date(v.exam_date))));
      const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
      const endCursor = new Date(now.getFullYear(), now.getMonth(), 1);
      while (cursor <= endCursor) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        monthBuckets[key] = 0;
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
  }
  for (const v of visits) {
    if (!v.exam_date) continue;
    const key = v.exam_date.slice(0, 7);
    if (key in monthBuckets) monthBuckets[key]++;
  }
  const maxMonth = Math.max(...Object.values(monthBuckets), 1);

  // Scan-type mix for top 10 doctors by volume
  const totalByDoctor = {};
  for (const v of visits) totalByDoctor[v.doctor_id] = (totalByDoctor[v.doctor_id] || 0) + 1;
  const topDoctors = doctors
    .map((d) => ({ ...d, total: totalByDoctor[d.id] || 0 }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  function scanTypesFor(docId) {
    const counts = {};
    for (const v of visits) {
      if (v.doctor_id !== docId) continue;
      for (const st of v.scan_types || []) counts[st] = (counts[st] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Doctor Tracking</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>Referral patterns to decide who to visit and who needs re-engaging.</p>

      <PeriodFilterBar years={years} year={dateFilter.year} quarter={dateFilter.quarter} month={dateFilter.month} day={dateFilter.day} onChange={setDateFilter} />

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {Object.entries(PERIODS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: period === key ? theme.navy : "#fff", color: period === key ? "#fff" : theme.navy,
              fontWeight: 700, cursor: "pointer", fontSize: 13, boxShadow: "0 2px 8px rgba(39,33,77,0.06)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Referral Volume, this {PERIODS[period].label.toLowerCase()}</h3>
          <BucketBar label="Less than 2 referrals" count={buckets.low} total={bucketTotal} color="#ba1a1a" />
          <BucketBar label="Between 2 and 4 referrals" count={buckets.mid} total={bucketTotal} color={theme.gold} />
          <BucketBar label="More than 4 referrals" count={buckets.high} total={bucketTotal} color="#2e7d32" />
          <p style={{ fontSize: 11, color: "#bbb", marginTop: 12 }}>Based on {docIdsWithAnyHistory.size} doctors with any referral history.</p>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Referrals, Last 12 Months</h3>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 8 }}>Click a bar to see that month's referrals.</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={Object.entries(monthBuckets).map(([key, count]) => ({ key, month: key.slice(5), count }))}
              onClick={(e) => { if (e && e.activePayload) openMonthDrill(e.activePayload[0].payload.month, e.activePayload[0].payload.key); }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ fill: "rgba(169,139,77,0.08)" }} />
              <Bar dataKey="count" fill={theme.gold} radius={[4, 4, 0, 0]} style={{ cursor: "pointer" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Doctors Gone Quiet</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          Had real referral history, but nothing in the last 60 days. Good candidates for a visit.
        </p>
        {dormant.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No dormant doctors, everyone with history has referred recently.</p>}
        {dormant.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
            <div>
              <Link href={`/dashboard/doctors/${d.id}`} style={{ fontWeight: 600, color: theme.navy, textDecoration: "none" }}>{d.name}</Link>
              <span style={{ color: theme.gold, fontSize: 12, marginLeft: 8 }}>{d.clinic_code}</span>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: theme.gray }}>
              <div>Last referral: {d.lastVisit.toLocaleDateString()}</div>
              <div>{d.totalHistorical} total historical referrals</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Scan Type Mix, Top 10 Doctors by Volume</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          Doctors who only ever send one scan type may not know your full catalog.
        </p>
        {topDoctors.map((d) => {
          const types = scanTypesFor(d.id);
          return (
            <div key={d.id} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: theme.navy, fontSize: 13 }}>
                  <Link href={`/dashboard/doctors/${d.id}`} style={{ color: theme.navy, textDecoration: "none" }}>{d.name}</Link>
                </span>
                <span style={{ fontSize: 11, color: theme.gray }}>{d.total} referrals, {types.length} distinct scan type{types.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {types.map(([name, count]) => (
                  <span key={name} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "#faf9fb", color: theme.navy }}>
                    {name} ({count})
                  </span>
                ))}
                {types.length === 1 && (
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "#fdecea", color: "#ba1a1a" }}>
                    Only sends one scan type
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {drill && (
        <DrillDownModal title={drill.title} subtitle={drill.subtitle} columns={drill.columns} rows={drill.rows} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

function BucketBar({ label, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: theme.navy, fontWeight: 600 }}>{label}</span>
        <span style={{ color: theme.gray }}>{count} doctor{count !== 1 ? "s" : ""}</span>
      </div>
      <div style={{ height: 12, background: "#f0f0f0", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 6 }} />
      </div>
    </div>
  );
}
