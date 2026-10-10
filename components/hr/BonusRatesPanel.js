"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import { formatMoney } from "../../lib/format";

// Per-employee bonus rates (client, 5 Oct 2026: "each employee profile holds
// its own pricing per exam type"). A blank cell means the default from the
// Bonus & Attendance Rules page applies.
const card = { background: "#fff", borderRadius: 16, padding: 24, marginTop: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };
const inp = { width: 90, padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 };
const th = { textAlign: "left", padding: "6px 8px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase" };
const td = { padding: "6px 8px", fontSize: 13, color: theme.navy, borderTop: "1px solid #f0f0f0" };

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` };
}

export default function BonusRatesPanel({ employeeId }) {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { if (employeeId) load(); }, [employeeId]);

  async function load() {
    const res = await fetch(`/api/hr/bonus-rates?employee=${employeeId}`, { headers: await authHeaders() });
    const j = await res.json();
    if (!res.ok) { setError(j.error || "Could not load rates."); return; }
    setRows(j.rates || []);
    setDraft(Object.fromEntries((j.rates || []).map((r) => [r.exam_type_id, { report: r.report_rate ?? "", raw: r.raw_rate ?? "" }])));
  }

  async function save(r) {
    setBusy(r.exam_type_id); setError("");
    const d = draft[r.exam_type_id] || {};
    const res = await fetch("/api/hr/bonus-rates", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ action: "save_employee_rate", employeeId, examTypeId: r.exam_type_id, reportRate: d.report, rawRate: d.raw }),
    });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) { setError(j.error || "Could not save."); return; }
    load();
  }

  return (
    <div style={card}>
      <h3 style={{ color: theme.navy, marginTop: 0 }}>Bonus Rates</h3>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 14 }}>
        What this person earns per scan type. Leave a cell blank to use the clinic default. Report bonus is paid only
        on eligible reports beyond the daily baseline (or on days with no shift); raw data bonus is paid on every upload.
        Standalone types are always paid.
      </p>
      {error && <p style={{ color: "#ba1a1a", fontSize: 12 }}>{error}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Scan type</th>
            <th style={th}>Report bonus (EGP)</th>
            <th style={th}>Raw data bonus (EGP)</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = draft[r.exam_type_id] || { report: "", raw: "" };
            const changed = String(d.report) !== String(r.report_rate ?? "") || String(d.raw) !== String(r.raw_rate ?? "");
            return (
              <tr key={r.exam_type_id}>
                <td style={td}>
                  {r.name}
                  {r.standalone && <span style={{ fontSize: 10, color: theme.gold, fontWeight: 700, marginLeft: 6 }}>STANDALONE</span>}
                </td>
                <td style={td}>
                  <input style={inp} type="number" min="0" placeholder={formatMoney(r.default_report_rate)} value={d.report}
                    onChange={(e) => setDraft({ ...draft, [r.exam_type_id]: { ...d, report: e.target.value } })} />
                </td>
                <td style={td}>
                  <input style={inp} type="number" min="0" placeholder={formatMoney(r.default_raw_rate)} value={d.raw}
                    onChange={(e) => setDraft({ ...draft, [r.exam_type_id]: { ...d, raw: e.target.value } })} />
                </td>
                <td style={td}>
                  {changed && (
                    <button disabled={busy === r.exam_type_id} onClick={() => save(r)}
                      style={{ background: theme.navy, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                      {busy === r.exam_type_id ? "Saving..." : "Save"}
                    </button>
                  )}
                  {!changed && r.updated_by_name && <span style={{ fontSize: 11, color: theme.gray }}>Set by {r.updated_by_name}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
