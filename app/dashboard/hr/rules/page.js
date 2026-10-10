"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";

// Bonus & Attendance Rules (v3, client voice notes 5 and 6 Oct 2026).
// One place for the clinic-wide defaults. Per-person rates live on each
// employee's profile. Saving here changes what the payslip calculates.
const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 18 };
const inp = { width: 90, padding: "7px 9px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };
const th = { textAlign: "left", padding: "6px 8px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase" };
const td = { padding: "6px 8px", fontSize: 13, color: theme.navy, borderTop: "1px solid #f0f0f0" };

const RULES = [
  ["late_grace_minutes", "Late grace (minutes)", "Arriving up to this late is not late. Above it, the whole lateness counts."],
  ["late_multiplier", "Late deduction multiplier", "Late minutes not covered by credits are deducted at this multiple."],
  ["early_credit_cap_minutes", "Early arrival counted up to (minutes)", "Arriving before the shift earns credit, capped here."],
  ["stay_credit_cap_minutes", "Staying late counted up to (minutes)", "Staying after the shift earns credit, capped here."],
  ["early_min_minutes", "Early arrival minimum (minutes)", "Early arrivals shorter than this are ignored."],
  ["overtime_min_minutes", "Overtime minimum per day (minutes)", "A day needs this much extra time to produce paid overtime. Less still covers lateness."],
  ["overtime_multiplier", "Overtime pay multiplier", "Overtime minutes are paid at the minute rate times this."],
  ["early_leave_multiplier", "Early leave multiplier", "Leaving early without an approved excuse."],
  ["early_leave_grace_minutes", "Early leave grace (minutes)", "Early leave up to this is ignored."],
  ["absence_day_multiplier", "Absence (days charged per absent day)", "The absent day is already unpaid; the extra charge is this minus one."],
  ["extra_day_multiplier", "Extra day multiplier", "A day worked with no shift pays one day times this."],
];
const SWITCHES = [
  ["grace_reduces_overtime", "Grace-period lateness reduces overtime", "Minutes late within the grace are never deducted, but are taken off extra time before overtime is paid."],
  ["pay_unverified_days", "Pay days with no clock record", "Days before an employee had an account, or for someone who never clocks in, are paid."],
];

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` };
}

export default function RulesPage() {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [types, setTypes] = useState([]);
  const [typeDraft, setTypeDraft] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const h = await authHeaders();
    const [s, t] = await Promise.all([
      fetch("/api/hr/bonus-rates?settings=1", { headers: h }).then((r) => r.json()),
      fetch("/api/hr/bonus-rates?types=1", { headers: h }).then((r) => r.json()),
    ]);
    if (s.error || t.error) { setMsg(s.error || t.error); return; }
    setSettings(s.settings); setDraft(s.settings || {});
    setTypes(t.types || []);
    setTypeDraft(Object.fromEntries((t.types || []).map((x) => [x.id, { ...x }])));
  }

  async function saveRules() {
    setBusy(true); setMsg("");
    const patch = { action: "settings" };
    for (const [k] of RULES) if (String(draft[k]) !== String(settings[k])) patch[k] = Number(draft[k]);
    for (const [k] of SWITCHES) if (draft[k] !== settings[k]) patch[k] = !!draft[k];
    if (draft.balance_mode !== settings.balance_mode) patch.balance_mode = draft.balance_mode;
    const res = await fetch("/api/hr/deductions", { method: "POST", headers: await authHeaders(), body: JSON.stringify(patch) });
    const j = await res.json();
    setBusy(false);
    setMsg(res.ok ? "Attendance rules saved. Payslips recalculate from now on." : j.error || "Could not save.");
    if (res.ok) load();
  }

  async function saveType(id) {
    const d = typeDraft[id];
    const res = await fetch("/api/hr/bonus-rates", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        action: "save_type", examTypeId: id, countsInBaseline: d.counts_in_report_baseline,
        standalone: d.standalone_bonus, defaultReportBonus: d.default_report_bonus, defaultRawBonus: d.default_raw_bonus,
      }),
    });
    const j = await res.json();
    setMsg(res.ok ? `${d.name} saved.` : j.error || "Could not save.");
    if (res.ok) load();
  }

  if (!settings) return <div style={{ padding: 30, color: theme.gray }}>{msg || "Loading..."}</div>;

  return (
    <div style={{ padding: 30, maxWidth: 1100 }}>
      <Link href="/dashboard/hr" style={{ fontSize: 12, color: theme.gray }}>← HR</Link>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Bonus & Attendance Rules</h1>
      <p style={{ color: theme.gray, fontSize: 13, marginTop: 0 }}>
        Clinic-wide defaults. Each employee's own bonus rates are on their profile.
      </p>
      {msg && <p style={{ fontSize: 13, color: theme.navy, fontWeight: 700 }}>{msg}</p>}

      <div style={card}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Attendance</h3>
        <div style={{ marginBottom: 12, fontSize: 13, color: theme.navy }}>
          <strong>Balance lateness over</strong>{" "}
          <select value={draft.balance_mode} onChange={(e) => setDraft({ ...draft, balance_mode: e.target.value })} style={{ ...inp, width: 160 }}>
            <option value="monthly">the whole month</option>
            <option value="daily">the same day only</option>
          </select>
          <span style={{ color: theme.gray, marginLeft: 8, fontSize: 12 }}>
            Monthly: arriving early or staying late on any day covers lateness on another.
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {RULES.map(([k, label, help]) => (
              <tr key={k}>
                <td style={{ ...td, width: 300, fontWeight: 700 }}>{label}</td>
                <td style={td}><input style={inp} type="number" min="0" step="0.5" value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></td>
                <td style={{ ...td, color: theme.gray, fontSize: 12 }}>{help}</td>
              </tr>
            ))}
            {SWITCHES.map(([k, label, help]) => (
              <tr key={k}>
                <td style={{ ...td, fontWeight: 700 }}>{label}</td>
                <td style={td}><input type="checkbox" checked={!!draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /></td>
                <td style={{ ...td, color: theme.gray, fontSize: 12 }}>{help}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button disabled={busy} onClick={saveRules}
          style={{ marginTop: 14, background: theme.navy, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, cursor: "pointer" }}>
          {busy ? "Saving..." : "Save attendance rules"}
        </button>
        <span style={{ fontSize: 11, color: theme.gray, marginLeft: 10 }}>Admin only.</span>
      </div>

      <div style={card}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Scan types and default bonus</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -6 }}>
          Eligible = counts toward the daily report baseline and earns the report bonus when extra.
          Standalone = always earns both bonuses, outside the baseline (e.g. Dental Photography).
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={th}>Scan type</th><th style={th}>Eligible</th><th style={th}>Standalone</th><th style={th}>Report (EGP)</th><th style={th}>Raw data (EGP)</th><th style={th}></th></tr>
          </thead>
          <tbody>
            {types.filter((t) => t.is_active).map((t) => {
              const d = typeDraft[t.id] || t;
              const changed = ["counts_in_report_baseline", "standalone_bonus", "default_report_bonus", "default_raw_bonus"].some((k) => String(d[k]) !== String(t[k]));
              const set = (k, v) => setTypeDraft({ ...typeDraft, [t.id]: { ...d, [k]: v } });
              return (
                <tr key={t.id}>
                  <td style={td}>{t.name}<span style={{ fontSize: 10, color: theme.gray, marginLeft: 6 }}>{t.category}</span></td>
                  <td style={td}><input type="checkbox" checked={!!d.counts_in_report_baseline} onChange={(e) => set("counts_in_report_baseline", e.target.checked)} /></td>
                  <td style={td}><input type="checkbox" checked={!!d.standalone_bonus} onChange={(e) => set("standalone_bonus", e.target.checked)} /></td>
                  <td style={td}><input style={inp} type="number" min="0" value={d.default_report_bonus} onChange={(e) => set("default_report_bonus", e.target.value)} /></td>
                  <td style={td}><input style={inp} type="number" min="0" value={d.default_raw_bonus} onChange={(e) => set("default_raw_bonus", e.target.value)} /></td>
                  <td style={td}>{changed && <button onClick={() => saveType(t.id)} style={{ background: theme.navy, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Save</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: theme.gray }}>
          Default values today: Both Arch {formatMoney(100)}, One Arch {formatMoney(50)}, Quadrant {formatMoney(25)},
          Endo {formatMoney(25)}, Dental Photography {formatMoney(50)}. Sinus and TMJ are set to 50 until confirmed.
        </p>
      </div>
    </div>
  );
}
