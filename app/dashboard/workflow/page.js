"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";

const card = {
  background: "#fff",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 4px 20px rgba(39,33,77,0.06)",
  marginBottom: 18,
};

function human(min) {
  const m = Number(min || 0);
  if (m < 90) return `${m.toFixed(0)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} hr`;
  return `${(m / 1440).toFixed(1)} days`;
}

export default function WorkflowBoardPage() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(`/api/workflow?days=${days}`, {
      headers: { Authorization: `Bearer ${session.session?.access_token}` },
    });
    setLoading(false);
    if (!res.ok) return;
    setData(await res.json());
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>
        <Link href="/dashboard" style={{ color: theme.gray }}>Dashboard</Link> &gt; Workflow
      </p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Workflow</h1>
      <p style={{ color: theme.gray, margin: "0 0 8px", maxWidth: 720 }}>
        Every step a visit goes through, how long it took, and how that compares to the target set for it.
        This reads the visits you already have. It changes nothing and asks nothing of anybody.
      </p>
      {/* Said plainly because the longer windows return the same figures: there
          is nothing before 29 August to show. Visits brought over in the import
          never passed through these steps, so counting them would read as
          hundreds of overdue jobs that nobody can act on. */}
      <p style={{ color: theme.gray, margin: "0 0 20px", maxWidth: 720, fontSize: 12 }}>
        Covers visits recorded in the platform from go-live on 29 August 2026. Earlier visits came across
        from the old files and never went through these steps, so they are not counted here.
      </p>

      <div style={{ marginBottom: 16 }}>
        {[7, 14, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            style={{ marginRight: 8, padding: "7px 14px", borderRadius: 999, cursor: "pointer",
                     fontWeight: 700, fontSize: 13,
                     border: days === d ? "none" : "1px solid #ddd",
                     background: days === d ? theme.navy : "#fff",
                     color: days === d ? "#fff" : theme.gray }}>
            {d} days
          </button>
        ))}
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 18 }}>
            {[
              { l: "Steps still open", v: data.counts.open, c: theme.navy },
              { l: "Open and past target", v: data.counts.open_breached, c: "#ba1a1a" },
              { l: "Completed in this window", v: data.counts.done, c: "#1e7a3c" },
            ].map((k) => (
              <div key={k.l} style={card}>
                <div style={{ fontSize: 10, color: theme.gray, fontWeight: 700, textTransform: "uppercase" }}>{k.l}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: k.c }}>{k.v}</div>
              </div>
            ))}
          </div>

          <div style={card}>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>How each step performs against its target</h3>
            <p style={{ fontSize: 12, color: theme.gray, marginTop: -6 }}>
              <strong>Measurable</strong> is the share of completions that were not ticked in the same action as the
              step before them. A step ticked one second after the previous one was not timed, it was recorded, and a
              duration taken from it means nothing.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: theme.navy, color: "#fff", textAlign: "left" }}>
                    {["Step", "Target", "Done", "Past target", "Median", "Slowest 10%", "Measurable"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sla.map((r) => (
                    <tr key={r.records} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: theme.navy }}>{r.records}</td>
                      <td style={{ padding: "8px 10px" }}>{human(r.target_minutes)}</td>
                      <td style={{ padding: "8px 10px" }}>{r.completed}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 700,
                                   color: Number(r.breach_rate) > 25 ? "#ba1a1a" : theme.navy }}>
                        {r.breached} ({r.breach_rate}%)
                      </td>
                      <td style={{ padding: "8px 10px" }}>{human(r.median_minutes)}</td>
                      <td style={{ padding: "8px 10px" }}>{human(r.p90_minutes)}</td>
                      <td style={{ padding: "8px 10px",
                                   color: Number(r.measurable_rate) < 50 ? "#a97c00" : theme.gray,
                                   fontWeight: Number(r.measurable_rate) < 50 ? 700 : 400 }}>
                        {r.measurable_rate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>Still open</h3>
            {data.open.length === 0 && (
              <p style={{ fontSize: 13, color: theme.gray, margin: 0 }}>Nothing outstanding in this window.</p>
            )}
            {data.open.map((r) => (
              <div key={`${r.visit_id}-${r.step_name}`}
                style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                         padding: "9px 0", borderBottom: "1px solid #f0f0f3" }}>
                <div>
                  <PatientLink row={r} />
                  <span style={{ color: theme.gray, fontSize: 12, marginLeft: 8 }}>
                    {r.exam_date} · {r.step_name}
                    {r.records !== r.step_name ? ` (records: ${r.records})` : ""}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: r.breached ? "#ba1a1a" : theme.gray }}>
                  {human(r.minutes_elapsed)} open
                  {r.target_minutes ? ` · target ${human(r.target_minutes)}` : " · no target set"}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Every patient name on the board opens that patient's record at the exact
// visit, scrolled into view and highlighted, so staff can see where the visit
// actually stands without leaving the board to search for it. Opened in a new
// tab because the board is a work queue: closing the tab returns you to your
// place in the list. Use this for any list on this page that names a patient.
function PatientLink({ row }) {
  if (!row.patient_id) {
    return <span style={{ fontWeight: 700, color: theme.navy }}>{row.patient_name}</span>;
  }
  return (
    <a
      href={`/dashboard/patients/${row.patient_id}?visit=${row.visit_id}`}
      target="_blank"
      rel="noreferrer"
      title="Open this patient at this visit"
      style={{ fontWeight: 700, color: theme.navy, textDecoration: "underline",
               textDecorationColor: theme.gold, textUnderlineOffset: 3 }}
    >
      {row.patient_name}
    </a>
  );
}
