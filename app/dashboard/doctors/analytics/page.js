"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";

const PERIODS = {
  month: { label: "Month", days: 30 },
  quarter: { label: "Quarter", days: 90 },
  half: { label: "Half Year", days: 182 },
  year: { label: "Year", days: 365 },
};

export default function DoctorAnalyticsPage() {
  const [period, setPeriod] = useState("quarter");
  const [doctors, setDoctors] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: docs } = await supabase.from("doctors").select("id, name, clinic_code");
    const { data: v } = await supabase.from("visits").select("doctor_id, exam_date, scan_types").not("doctor_id", "is", null);
    setDoctors(docs || []);
    setVisits(v || []);
    setLoading(false);
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

  // 12-month trend, all doctors combined
  const monthBuckets = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthBuckets[key] = 0;
  }
  for (const v of visits) {
    if (!v.exam_date) continue;
    const d = new Date(v.exam_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
      <p style={{ color: theme.gray, fontSize: 13, marginBottom: 8 }}>
        <a href="/dashboard/doctors" style={{ color: theme.gray }}>Doctors</a> &gt; Analytics
      </p>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Doctor Tracking</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>Referral patterns to decide who to visit and who needs re-engaging.</p>

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
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140 }}>
            {Object.entries(monthBuckets).map(([key, count]) => (
              <div key={key} style={{ flex: 1, textAlign: "center" }}>
                <div
                  title={`${key}: ${count}`}
                  style={{
                    height: `${Math.max((count / maxMonth) * 110, 2)}px`,
                    background: `linear-gradient(180deg, ${theme.gold}, ${theme.goldLight})`,
                    borderRadius: "3px 3px 0 0",
                  }}
                />
                <div style={{ fontSize: 8, color: theme.gray, marginTop: 4 }}>{key.slice(5)}</div>
              </div>
            ))}
          </div>
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
              <span style={{ fontWeight: 600, color: theme.navy }}>{d.name}</span>
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
                <span style={{ fontWeight: 600, color: theme.navy, fontSize: 13 }}>{d.name}</span>
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
