"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import DrillDownModal from "./DrillDownModal";
import PeriodFilterBar, { getDateRange } from "./PeriodFilterBar";
import { fetchAll, cairoToday } from "../../lib/dashboardData";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { useT } from "../../lib/i18n";

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
const monthLabel = (key) => key.slice(5) + "/" + key.slice(2, 4);

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

const PERIODS = {
  month: { label: "Month", days: 30, heading: "Referral Volume, this month" },
  quarter: { label: "Quarter", days: 90, heading: "Referral Volume, this quarter" },
  half: { label: "Half Year", days: 182, heading: "Referral Volume, this half year" },
  year: { label: "Year", days: 365, heading: "Referral Volume, this year" },
};

export default function DoctorAnalytics() {
  const { t } = useT();
  const [period, setPeriod] = useState("quarter");
  const [doctors, setDoctors] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [dateFilter, setDateFilter] = useState({ year: "", quarter: "", month: "" });
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  useAutoRefresh(["visits", "doctors"], load);

  // Silent on refresh: "Loading" only shows until the first load completes.
  async function load() {
    try {
      const [docs, v] = await Promise.all([
        fetchAll(() => supabase.from("doctors").select("id, name, clinic_code")),
        fetchAll(() => supabase.from("visits").select("doctor_id, patient_id, exam_date, scan_types, patients(name)").not("doctor_id", "is", null)),
      ]);
      setDoctors(docs);
      setVisits(v);
      setError(null);
    } catch (e) {
      setError(e.message || "Could not load doctor data.");
    } finally {
      setLoading(false);
    }
  }

  function openMonthDrill(monthLabel, key) {
    const docById = Object.fromEntries(doctors.map((d) => [d.id, d.name]));
    const rows = visits
      .filter((v) => hasRealDate(v) && v.exam_date.startsWith(key))
      .map((v) => ({ doctor: docById[v.doctor_id] || "—", patient: v.patients?.name || "—", date: v.exam_date, scans: (v.scan_types || []).join(", ") }));
    setDrill({
      title: t("Referrals in {month}", { month: monthLabel }),
      subtitle: rows.length === 1 ? t("1 referral") : t("{n} referrals", { n: rows.length }),
      columns: [
        { key: "doctor", label: t("Doctor") },
        { key: "patient", label: t("Patient") },
        { key: "scans", label: t("Scan Types") },
        { key: "date", label: t("Date") },
      ],
      rows,
    });
  }

  if (loading) return <p style={{ color: theme.gray }}>{t("Loading...")}</p>;
  if (error && visits.length === 0) return <p style={{ color: "#ba1a1a" }}>{t("Could not load doctor data: {error}", { error: t(error) })}</p>;

  const scanName = buildScanNamer(visits);
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
    if (!hasRealDate(v)) continue;
    const d = new Date(v.exam_date);
    if (!lastVisitByDoctor[v.doctor_id] || d > lastVisitByDoctor[v.doctor_id]) {
      lastVisitByDoctor[v.doctor_id] = d;
    }
  }
  const dormant = doctors
    .filter((d) => lastVisitByDoctor[d.id] && lastVisitByDoctor[d.id] < dormantCutoff)
    .map((d) => ({ ...d, lastVisit: lastVisitByDoctor[d.id], totalHistorical: visits.filter((v) => v.doctor_id === d.id).length }))
    .sort((a, b) => a.lastVisit - b.lastVisit);

  // Referral trend: last 12 months by default, or the selected calendar period
  const years = [...new Set(visits.filter(hasRealDate).map((v) => v.exam_date.slice(0, 4)))].sort().reverse();
  const { start: filterStart, end: filterEnd } = getDateRange(dateFilter);
  const monthBuckets = {};
  if (filterStart) {
    for (const key of monthKeys(filterStart.slice(0, 7), filterEnd.slice(0, 7))) monthBuckets[key] = 0;
  } else {
    const endKey = cairoToday().slice(0, 7);
    let y = parseInt(endKey.slice(0, 4), 10);
    let m = parseInt(endKey.slice(5, 7), 10) - 11;
    if (m < 1) { m += 12; y--; }
    for (const key of monthKeys(`${y}-${String(m).padStart(2, "0")}`, endKey)) monthBuckets[key] = 0;
  }
  for (const v of visits) {
    if (!hasRealDate(v)) continue;
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

  // Leaderboard. "Patients referred" counts DISTINCT patients, which is the
  // number that actually answers "who sends us the most people" - visit count
  // inflates any doctor whose patients come back for repeat scans.
  const leaderboardSource = filterStart
    ? visits.filter((v) => v.exam_date && v.exam_date >= filterStart && v.exam_date <= filterEnd)
    : visits;

  const statsByDoctor = {};
  for (const v of leaderboardSource) {
    if (!v.doctor_id) continue;
    const st = (statsByDoctor[v.doctor_id] = statsByDoctor[v.doctor_id] || { visits: 0, patients: new Set(), scans: {} });
    st.visits++;
    if (v.patient_id) st.patients.add(v.patient_id);
    for (const t of v.scan_types || []) {
      const n = scanName(t);
      if (n) st.scans[n] = (st.scans[n] || 0) + 1;
    }
  }
  const docNameById = Object.fromEntries(doctors.map((d) => [d.id, d]));
  const leaderboard = Object.entries(statsByDoctor)
    .map(([id, st]) => ({
      id,
      name: docNameById[id]?.name || t("Unknown doctor"),
      clinic: docNameById[id]?.clinic_code || "",
      patients: st.patients.size,
      visits: st.visits,
      topScans: Object.entries(st.scans).sort((a, b) => b[1] - a[1]).slice(0, 3),
    }))
    .sort((a, b) => b.patients - a.patients || b.visits - a.visits)
    .slice(0, 15);
  const maxPatients = Math.max(...leaderboard.map((d) => d.patients), 1);

  // Overall scan-type demand across every referral in the selected window.
  const scanDemand = {};
  for (const v of leaderboardSource) {
    for (const t of v.scan_types || []) {
      const n = scanName(t);
      if (n) scanDemand[n] = (scanDemand[n] || 0) + 1;
    }
  }
  const topScanTypes = Object.entries(scanDemand).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const scanDemandTotal = Object.values(scanDemand).reduce((a, b) => a + b, 0) || 1;

  function openDoctorDrill(doc) {
    const rows = leaderboardSource
      .filter((v) => v.doctor_id === doc.id)
      .map((v) => ({ patient: v.patients?.name || "-", date: v.exam_date, scans: (v.scan_types || []).join(", ") }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setDrill({
      title: doc.name,
      subtitle: t("{patients} referred across {visits}", { patients: doc.patients === 1 ? t("1 patient") : t("{n} patients", { n: doc.patients }), visits: doc.visits === 1 ? t("1 visit") : t("{n} visits", { n: doc.visits }) }),
      columns: [
        { key: "patient", label: t("Patient") },
        { key: "scans", label: t("Scan Types") },
        { key: "date", label: t("Date") },
      ],
      rows,
    });
  }

  function scanTypesFor(docId) {
    const counts = {};
    for (const v of visits) {
      if (v.doctor_id !== docId) continue;
      for (const t of v.scan_types || []) {
        const n = scanName(t);
        if (n) counts[n] = (counts[n] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>{t("Doctor Tracking")}</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>{t("Referral patterns to decide who to visit and who needs re-engaging.")}</p>

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
            {t(p.label)}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t(PERIODS[period].heading)}</h3>
          <BucketBar label={t("Less than 2 referrals")} count={buckets.low} total={bucketTotal} color="#ba1a1a" />
          <BucketBar label={t("Between 2 and 4 referrals")} count={buckets.mid} total={bucketTotal} color={theme.gold} />
          <BucketBar label={t("More than 4 referrals")} count={buckets.high} total={bucketTotal} color="#2e7d32" />
          <p style={{ fontSize: 11, color: "#bbb", marginTop: 12 }}>{t("Based on {n} doctors with any referral history.", { n: docIdsWithAnyHistory.size })}</p>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{filterStart ? t("Referrals by Month") : t("Referrals, Last 12 Months")}</h3>
          <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 8 }}>{t("Click a bar to see that month's referrals.")}</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={Object.entries(monthBuckets).map(([key, count]) => ({ key, month: monthLabel(key), count }))}
              onClick={(e) => { if (e && e.activePayload) openMonthDrill(e.activePayload[0].payload.month, e.activePayload[0].payload.key); }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ fill: "rgba(169,139,77,0.08)" }} />
              <Bar dataKey="count" name={t("Referrals")} fill={theme.gold} radius={[4, 4, 0, 0]} style={{ cursor: "pointer" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Top Referring Doctors")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {filterStart
              ? t("Ranked by how many distinct patients they sent in the selected period. Click a doctor to see every referral.")
              : t("Ranked by how many distinct patients they sent across all history. Click a doctor to see every referral.")}
          </p>
          {leaderboard.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{t("No referrals in this period.")}</p>}
          {leaderboard.map((d, i) => (
            <div key={d.id} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: i < 3 ? theme.gold : "#f0f0f0", color: i < 3 ? "#fff" : theme.gray, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {i + 1}
                </span>
                <button
                  onClick={() => openDoctorDrill(d)}
                  style={{ flex: 1, textAlign: "start", background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: theme.navy, fontSize: 13 }}
                >
                  {d.name}
                  {d.clinic && <span style={{ color: theme.gold, fontSize: 11, marginInlineStart: 6 }}>{d.clinic}</span>}
                </button>
                <span style={{ fontSize: 13, fontWeight: 700, color: theme.navy, whiteSpace: "nowrap" }}>
                  {d.patients === 1 ? t("1 patient") : t("{n} patients", { n: d.patients })}
                </span>
              </div>
              <div style={{ height: 6, background: "#f0f0f0", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                <div style={{ height: "100%", width: `${(d.patients / maxPatients) * 100}%`, background: theme.navy, borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: theme.gray }}>{d.visits === 1 ? t("1 visit") : t("{n} visits", { n: d.visits })} &middot; {t("usually asks for:")}</span>
                {d.topScans.map(([name, count]) => (
                  <span key={name} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "#faf9fb", color: theme.navy }}>
                    {name} ({count})
                  </span>
                ))}
                {d.topScans.length === 0 && <span style={{ fontSize: 11, color: theme.gray }}>{t("no scan types recorded")}</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Most Requested Scan Types")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
            {t("What doctors actually send patients in for, across all referrals.")}
          </p>
          {topScanTypes.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{t("No scan types recorded in this period.")}</p>}
          {topScanTypes.map(([name, count]) => (
            <div key={name} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: theme.navy, fontWeight: 600 }}>{name}</span>
                <span style={{ color: theme.gray, whiteSpace: "nowrap", marginInlineStart: 8 }}>
                  {count} ({((count / scanDemandTotal) * 100).toFixed(0)}%)
                </span>
              </div>
              <div style={{ height: 8, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(count / topScanTypes[0][1]) * 100}%`, background: theme.gold, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Doctors Gone Quiet")}</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          {t("Had real referral history, but nothing in the last 60 days. Good candidates for a visit.")}
        </p>
        {dormant.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>{t("No dormant doctors, everyone with history has referred recently.")}</p>}
        {dormant.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
            <div>
              <Link href={`/dashboard/doctors/${d.id}`} style={{ fontWeight: 600, color: theme.navy, textDecoration: "none" }}>{d.name}</Link>
              <span style={{ color: theme.gold, fontSize: 12, marginInlineStart: 8 }}>{d.clinic_code}</span>
            </div>
            <div style={{ textAlign: "end", fontSize: 12, color: theme.gray }}>
              <div>{t("Last referral: {date}", { date: d.lastVisit.toLocaleDateString() })}</div>
              <div>{t("{n} total historical referrals", { n: d.totalHistorical })}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Scan Type Mix, Top 10 Doctors by Volume")}</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
          {t("Doctors who only ever send one scan type may not know your full catalog.")}
        </p>
        {topDoctors.map((d) => {
          const types = scanTypesFor(d.id);
          return (
            <div key={d.id} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: theme.navy, fontSize: 13 }}>
                  <Link href={`/dashboard/doctors/${d.id}`} style={{ color: theme.navy, textDecoration: "none" }}>{d.name}</Link>
                </span>
                <span style={{ fontSize: 11, color: theme.gray }}>{types.length === 1 ? t("{n} referrals, 1 distinct scan type", { n: d.total }) : t("{n} referrals, {types} distinct scan types", { n: d.total, types: types.length })}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {types.map(([name, count]) => (
                  <span key={name} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "#faf9fb", color: theme.navy }}>
                    {name} ({count})
                  </span>
                ))}
                {types.length === 1 && (
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "#fdecea", color: "#ba1a1a" }}>
                    {t("Only sends one scan type")}
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
  const { t } = useT();
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: theme.navy, fontWeight: 600 }}>{label}</span>
        <span style={{ color: theme.gray }}>{count === 1 ? t("1 doctor") : t("{n} doctors", { n: count })}</span>
      </div>
      <div style={{ height: 12, background: "#f0f0f0", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 6 }} />
      </div>
    </div>
  );
}
