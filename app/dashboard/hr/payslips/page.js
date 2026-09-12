"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";

const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };
const inp = { padding: "9px 11px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };

function thisPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export default function PayslipsPage() {
  const [employees, setEmployees] = useState([]);
  const [rules, setRules] = useState([]);
  const [selected, setSelected] = useState("");
  const [period, setPeriod] = useState(thisPeriod());
  const [otHours, setOtHours] = useState("");
  const [otAmount, setOtAmount] = useState("");
  const [otNote, setOtNote] = useState("");
  const [otBusy, setOtBusy] = useState(false);
  const [slip, setSlip] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apply, setApply] = useState({ ruleId: "", occurredOn: "", note: "", amountOverride: "" });

  useEffect(() => { init(); }, []);
  useEffect(() => { if (selected) loadSlip(); }, [selected, period]);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function init() {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name, hr_id")
      .eq("is_active", true)
      .order("name");
    setEmployees(emps || []);
    const res = await fetch("/api/hr/payroll?rules=1", { headers: { Authorization: `Bearer ${await token()}` } });
    if (res.ok) setRules((await res.json()).rules.filter((r) => r.is_active !== false));
    if (emps?.length) setSelected(emps[0].id);
  }

  async function loadSlip() {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/hr/payroll?payslip=${selected}&period=${period}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const j = await res.json();
    if (!res.ok) setError(j.error || "Could not build that payslip.");
    else setSlip(j.payslip);
    setLoading(false);
  }

  async function addAdjustment() {
    setError("");
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "apply", employeeId: selected, period, ...apply }),
    });
    const j = await res.json();
    if (!res.ok) return setError(j.error);
    setApply({ ruleId: "", occurredOn: "", note: "", amountOverride: "" });
    loadSlip();
  }

  async function removeAdjustment(id) {
    await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "remove_adjustment", id }),
    });
    loadSlip();
  }

  const STATUS = {
    worked: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Worked" },
    absent: { bg: "#fdecea", fg: "#ba1a1a", label: "Absent" },
    needs_review: { bg: "#fff8e1", fg: "#a97c00", label: "No sign-out" },
  };

  async function decideOvertime(status) {
    setOtBusy(true);
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({
        action: "decide_overtime",
        employeeId: selected,
        period,
        status,
        hours: otHours === "" ? slip?.overtimeHours : Number(otHours),
        amount: Number(otAmount),
        note: otNote || null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setOtBusy(false);
    if (!res.ok) { alert(j.error || "Could not save that decision."); return; }
    setOtHours(""); setOtAmount(""); setOtNote("");
    loadSlip();
  }

  async function reopenOvertime() {
    setOtBusy(true);
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "undo_overtime", employeeId: selected, period }),
    });
    const j = await res.json().catch(() => ({}));
    setOtBusy(false);
    if (!res.ok) { alert(j.error || "Could not reopen that decision."); return; }
    loadSlip();
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Payslips</h1>
      <p style={{ color: theme.gray, marginBottom: 18 }}>
        Live for the current month. Monthly staff are paid their salary; hourly staff are paid the scheduled hours of
        each day their attendance confirms.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <select style={{ ...inp, minWidth: 220 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.hr_id ? ` (${e.hr_id})` : ""}</option>)}
        </select>
        <input type="month" style={inp} value={period} onChange={(e) => setPeriod(e.target.value)} />
      </div>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      {loading && <p style={{ color: theme.gray }}>Loading...</p>}

      {slip && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
            {[
              { l: "Base pay", v: `${formatMoney(slip.basePay)} EGP`, c: theme.navy },
              { l: "Bonuses", v: `+${formatMoney(slip.totalBonuses)}`, c: "#1e7a3c" },
              { l: "Deductions", v: `−${formatMoney(slip.totalDeductions)}`, c: "#ba1a1a" },
              { l: "Net pay", v: `${formatMoney(slip.net)} EGP`, c: theme.gold },
            ].map((k) => (
              <div key={k.l} style={card}>
                <div style={{ fontSize: 10, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{k.l}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: k.c }}>{k.v}</div>
              </div>
            ))}
          </div>

          <div style={{ ...card, marginBottom: 18 }}>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>
              How the base pay was reached
              <span style={{ fontSize: 11, fontWeight: 400, color: theme.gray, marginLeft: 8 }}>
                {slip.payBasis === "hourly" ? `Hourly · ${formatMoney(slip.hourlyRate)} EGP/hr` : "Monthly salary"}
              </span>
            </h3>
            {slip.payBasis === "hourly" ? (
              <p style={{ fontSize: 13, color: theme.navy, margin: "0 0 10px" }}>
                {slip.paidDays} of {slip.scheduledDays} scheduled days confirmed · {slip.paidHours.toFixed(1)} hours ×{" "}
                {formatMoney(slip.hourlyRate)} = <strong>{formatMoney(slip.basePay)} EGP</strong>
              </p>
            ) : (
              <p style={{ fontSize: 13, color: theme.navy, margin: "0 0 10px" }}>
                Fixed monthly salary of {formatMoney(slip.basePay)} EGP. Attendance does not reduce it directly —
                an unworked day reaches the payslip as a deduction below, so it is always visible why.
              </p>
            )}
            {slip.needsReview > 0 && (
              <p style={{ fontSize: 12, color: "#a97c00", fontWeight: 700, margin: 0 }}>
                {slip.needsReview} day{slip.needsReview === 1 ? "" : "s"} signed in with no sign-out — waiting on an
                admin in the Action Center. Not paid or unpaid until decided.
              </p>
            )}
          </div>

          {slip.payBasis === "hourly" && (slip.overtimeHours > 0 || slip.overtimeDecision) && (
            <div style={{ ...card, marginBottom: 18, borderLeft: `4px solid ${theme.gold}` }}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>
                Overtime
                <span style={{ fontSize: 11, fontWeight: 400, color: theme.gray, marginLeft: 8 }}>
                  Hours worked beyond the schedule. Never paid automatically.
                </span>
              </h3>

              {slip.overtimeDecision ? (
                <div style={{ fontSize: 13, color: theme.navy }}>
                  {slip.overtimeDecision.status === "approved" ? (
                    <p style={{ margin: "0 0 6px" }}>
                      <strong>{Number(slip.overtimeDecision.hours_approved).toFixed(2)} h approved</strong> at{" "}
                      <strong>{formatMoney(slip.overtimeDecision.amount)} EGP</strong>, added as a bonus below.
                    </p>
                  ) : (
                    <p style={{ margin: "0 0 6px" }}>
                      <strong>Waived.</strong> {Number(slip.overtimeHours).toFixed(2)} h were recorded and
                      deliberately not paid.
                    </p>
                  )}
                  <p style={{ margin: 0, fontSize: 12, color: theme.gray }}>
                    Decided by {slip.overtimeDecision.decided_by}
                    {slip.overtimeDecision.note ? ` · ${slip.overtimeDecision.note}` : ""}
                  </p>
                  <button onClick={reopenOvertime} disabled={otBusy}
                    style={{ marginTop: 10, background: "transparent", color: theme.navy, border: `1px solid ${theme.gray}`,
                             borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                    Reopen
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: theme.navy, margin: "0 0 10px" }}>
                    <strong>{Number(slip.overtimeHours).toFixed(2)} hours</strong> recorded beyond the schedule.
                    At the hourly rate that would be {formatMoney(slip.overtimeIndicativeValue)} EGP, shown only as
                    a reference — enter whatever it is actually worth.
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input type="number" step="0.01" placeholder={`Hours (max ${Number(slip.overtimeHours).toFixed(2)})`}
                      value={otHours} onChange={(e) => setOtHours(e.target.value)}
                      style={{ ...inp, width: 170 }} />
                    <input type="number" step="0.01" placeholder="Amount in EGP"
                      value={otAmount} onChange={(e) => setOtAmount(e.target.value)}
                      style={{ ...inp, width: 150 }} />
                    <input type="text" placeholder="Reason (optional)"
                      value={otNote} onChange={(e) => setOtNote(e.target.value)}
                      style={{ ...inp, flex: 1, minWidth: 180 }} />
                    <button onClick={() => decideOvertime("approved")} disabled={otBusy || !otAmount}
                      style={{ background: theme.navy, color: "#fff", border: "none", borderRadius: 8,
                               padding: "9px 16px", fontWeight: 700, cursor: "pointer", opacity: otBusy || !otAmount ? 0.5 : 1 }}>
                      Approve
                    </button>
                    <button onClick={() => decideOvertime("waived")} disabled={otBusy}
                      style={{ background: "transparent", color: theme.navy, border: `1px solid ${theme.gray}`,
                               borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: "pointer" }}>
                      Waive
                    </button>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: theme.gray }}>
                    Waiving still records the decision and who made it, so unpaid overtime is always a choice
                    someone made rather than something that quietly disappeared.
                  </p>
                </>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }}>
            <div style={card}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>Adjustments this month</h3>
              {[...slip.bonuses, ...slip.deductions].length === 0 && (
                <p style={{ fontSize: 13, color: theme.gray }}>Nothing applied.</p>
              )}
              {[...slip.bonuses, ...slip.deductions].map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f2f2f2" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: theme.gray }}>
                      {a.occurred_on || "—"}{a.note ? ` · ${a.note}` : ""}{a.created_by_name ? ` · by ${a.created_by_name}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 800, color: a.kind === "bonus" ? "#1e7a3c" : "#ba1a1a" }}>
                      {a.kind === "bonus" ? "+" : "−"}{formatMoney(a.amount)}
                    </span>
                    <button onClick={() => removeAdjustment(a.id)}
                      style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: "#ba1a1a", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              <div style={{ background: "#faf9fb", borderRadius: 10, padding: 12, marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#48464E", marginBottom: 8 }}>Apply a rule</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select style={{ ...inp, flex: 1, minWidth: 160 }} value={apply.ruleId}
                    onChange={(e) => setApply({ ...apply, ruleId: e.target.value })}>
                    <option value="">Choose a rule...</option>
                    {rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.kind === "bonus" ? "＋ " : "− "}{r.name} ({r.rule_type === "fixed" ? `${r.value} EGP` : r.rule_type === "day_multiplier" ? `${r.value} days` : `${r.value}%`})
                      </option>
                    ))}
                  </select>
                  <input type="date" style={{ ...inp, width: 150 }} value={apply.occurredOn}
                    onChange={(e) => setApply({ ...apply, occurredOn: e.target.value })} />
                  <input style={{ ...inp, width: 110 }} value={apply.amountOverride} placeholder="override EGP"
                    onChange={(e) => setApply({ ...apply, amountOverride: e.target.value })} />
                  <input style={{ ...inp, flex: 1, minWidth: 140 }} value={apply.note} placeholder="Note (optional)"
                    onChange={(e) => setApply({ ...apply, note: e.target.value })} />
                  <button onClick={addAdjustment}
                    style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Apply
                  </button>
                </div>
                <p style={{ fontSize: 11, color: theme.gray, margin: "8px 0 0" }}>
                  The date matters for &quot;days of pay&quot; rules — a day is worth that day&apos;s scheduled hours.
                  The amount is fixed when applied, so editing the rule later never changes this payslip.
                </p>
              </div>
            </div>

            <div style={card}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>Attendance</h3>
              {slip.days.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>No scheduled days this month.</p>}
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {slip.days.map((d) => {
                  const st = STATUS[d.status];
                  return (
                    <div key={d.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
                      <span style={{ fontSize: 12, color: theme.navy }}>
                        {new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        <span style={{ color: theme.gray }}> · {d.hours.toFixed(1)}h</span>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.fg }}>
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
