"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

export default function ScanInsights() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    let all = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase.from("visits").select("scan_types, exam_date, branch_id, payment_status").range(from, from + pageSize - 1);
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
  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const maxTypeCount = Math.max(...topTypes.map(([, c]) => c), 1);

  // last 12 months trend
  const now = new Date();
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
    if (key in monthBuckets) monthBuckets[key] += v.scan_types?.length || 0;
  }
  const maxMonth = Math.max(...Object.values(monthBuckets), 1);

  const paidCount = visits.filter((v) => v.payment_status === "paid").length;
  const paidRate = totalVisits > 0 ? ((paidCount / totalVisits) * 100).toFixed(0) : 0;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Scans" value={totalScans.toLocaleString()} />
        <StatCard label="Total Visits" value={totalVisits.toLocaleString()} />
        <StatCard label="Distinct Scan Types Used" value={Object.keys(typeCounts).length} />
        <StatCard label="Visits Paid in Full" value={`${paidRate}%`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Scans, Last 12 Months</h3>
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

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Top Scan Types</h3>
          {topTypes.map(([name, count]) => (
            <div key={name} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: theme.navy, fontWeight: 600 }}>{name}</span>
                <span style={{ color: theme.gray }}>{count}</span>
              </div>
              <div style={{ height: 8, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(count / maxTypeCount) * 100}%`, background: theme.navy, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
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
