"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";
import { useT, tx, Ltr } from "../../../../lib/i18n";

const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };
const inp = { padding: "9px 11px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };

function thisPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export default function PayslipsPage() {
  const { t, tCode, isAr } = useT();
  const [employees, setEmployees] = useState([]);
  const [rules, setRules] = useState([]);
  const [selected, setSelected] = useState("");
  const [period, setPeriod] = useState(thisPeriod());
  const [otHours, setOtHours] = useState("");
  const [otAmount, setOtAmount] = useState("");
  const [otNote, setOtNote] = useState("");
  const [otBusy, setOtBusy] = useState(false);
  const [trial, setTrial] = useState(null);
  const [trialBusy, setTrialBusy] = useState(false);
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

  async function decideAdjustment(a, status) {
    let amount = null;
    if (status === "approved") {
      const v = prompt(tx("Approve \"{label}\". Amount in EGP (leave as is to approve the proposed figure):", { label: tx(a.label) }), String(a.amount));
      if (v === null) return;
      amount = v === "" ? null : Number(v);
    } else if (!confirm(tx("Reject \"{label}\" ({amount} EGP)? It will not reach the payslip.", { label: tx(a.label), amount: formatMoney(a.amount) }))) {
      return;
    }
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "decide_adjustment", id: a.id, status, amount }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(tx(j.error || "Could not save that decision.")); return; }
    loadSlip();
  }

  const STATUS = {
    present: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Worked" },
    worked: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Worked" },
    extra_day: { bg: "#e3f2fd", fg: "#1565c0", label: "Off-roster day" },
    absent: { bg: "#fdecea", fg: "#ba1a1a", label: "Absent" },
    excused: { bg: "#f3e5f5", fg: "#6a1b9a", label: "Excused" },
    missing_signout: { bg: "#fff8e1", fg: "#a97c00", label: "No sign-out" },
    needs_review: { bg: "#fff8e1", fg: "#a97c00", label: "No sign-out" },
    future: { bg: "#f2f2f2", fg: "#777", label: "Upcoming" },
    onboarding: { bg: "#f2f2f2", fg: "#777", label: "First day" },
    before_account: { bg: "#f2f2f2", fg: "#777", label: "Before account" },
    no_clock_data: { bg: "#f2f2f2", fg: "#777", label: "No clock" },
  };
  const ADJ_STATUS = {
    pending: { bg: "#fff8e1", fg: "#a97c00", label: "Waiting for approval" },
    approved: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Approved" },
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
        amount: otAmount === "" ? Number(slip?.overtimeIndicativeValue || 0) : Number(otAmount),
        note: otNote || null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setOtBusy(false);
    if (!res.ok) { alert(tx(j.error || "Could not save that decision.")); return; }
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
    if (!res.ok) { alert(tx(j.error || "Could not reopen that decision.")); return; }
    loadSlip();
  }


  // Generate the payslip for the month picked above (Mohamed Said, 3 Nov
  // 2026). The employee page always generates the current month, so paying
  // October on 3 November had no way in.
  const [genBusy, setGenBusy] = useState(false);
  async function generateForPeriod() {
    const emp = employees.find((e) => e.id === selected);
    if (!emp) return;
    if (!confirm(isAr
      ? `طلّع قسيمة ${emp.name} لشهر ${period}؟ بعد كده بتظهر في صفحة الموظف وتقدر تأكد صرفها.`
      : `Generate ${emp.name}'s payslip for ${period}? It then shows on the employee page, ready to confirm as paid.`)) return;
    setGenBusy(true);
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "generate", employeeId: selected, period }),
    });
    const j = await res.json().catch(() => ({}));
    setGenBusy(false);
    if (!res.ok) { alert(tx(j.error || "Could not generate that payslip.")); return; }
    if (confirm(isAr
      ? `اتطلعت القسيمة. الصافي ${formatMoney(j.payslip?.net_total, { decimals: 2 })} جنيه. تفتح صفحة الموظف تأكد الصرف؟`
      : `Payslip generated. Net ${formatMoney(j.payslip?.net_total, { decimals: 2 })} EGP. Open the employee page to confirm payment?`)) {
      window.location.href = `/dashboard/hr/${selected}`;
    }
  }

  async function runTrial() {
    setTrialBusy(true);
    const res = await fetch(`/api/hr/payroll?trial=${period}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const j = await res.json().catch(() => ({}));
    setTrialBusy(false);
    if (!res.ok) { alert(tx(j.error || "Could not run the parallel payroll.")); return; }
    setTrial(j);
  }

  // Downloaded so it can be laid beside the manual payroll line by line.
  // That comparison is the entire point of a parallel month.
  function downloadTrial() {
    if (!trial?.rows?.length) return;
    const cols = ["employee_name","hr_id","pay_basis","paid_days","paid_hours","overtime_hours",
      "gross","scan_commission","report_bonus","bonuses","rule_deductions","penalty_deductions",
      "deferred_to_next","advance_taken","tab_taken","cash_swept","still_held","indicative_net","flags"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...trial.rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `payroll-parallel-${trial.period}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>{t("Payslips")}</h1>
      <p style={{ color: theme.gray, marginBottom: 18 }}>
        {t("Live for the current month. Monthly staff are paid their salary; hourly staff are paid the scheduled hours of each day their attendance confirms.")}
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <select style={{ ...inp, minWidth: 220 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.hr_id ? ` (${e.hr_id})` : ""}</option>)}
        </select>
        <input type="month" style={inp} value={period} onChange={(e) => setPeriod(e.target.value)} />
        <button onClick={generateForPeriod} disabled={genBusy || !selected}
          style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 800, cursor: "pointer", opacity: genBusy ? 0.5 : 1 }}>
          {genBusy ? t("Saving...") : (isAr ? `طلّع قسيمة ${period}` : `Generate payslip for ${period}`)}
        </button>
      </div>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{t(error)}</p>}
      <div style={{ ...card, marginBottom: 18, borderInlineStart: `4px solid ${theme.navy}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ color: theme.navy, margin: 0 }}>{t("Parallel run")}</h3>
            <p style={{ fontSize: 12, color: theme.gray, margin: "4px 0 0", maxWidth: 640 }}>
              {t("Runs the whole month for everyone using the same arithmetic as a real payslip, and settles nothing. No advance is repaid, no tab is cleared, no cash is swept. Put it beside the manual payroll and look for the rows that disagree.")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={runTrial} disabled={trialBusy}
              style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: theme.navy,
                       color: "#fff", fontWeight: 700, cursor: "pointer", opacity: trialBusy ? 0.5 : 1 }}>
              {trialBusy ? t("Running...") : t("Run {period}", { period })}
            </button>
            {trial?.rows?.length > 0 && (
              <button onClick={downloadTrial}
                style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${theme.navy}`,
                         background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer" }}>
                {t("Download")}
              </button>
            )}
          </div>
        </div>

        {trial?.is_locked_trial && (
          <p style={{ marginTop: 12, marginBottom: 0, padding: 10, borderRadius: 8, background: "#FBF7EF",
                      fontSize: 12, color: theme.navy }}>
            <strong>{t("{period} is the trial month.", { period: trial.period })}</strong> {t("A payslip cannot be committed for it. Clear the trial month in payroll settings when the comparison is done and the system is ready to be the record.")}
          </p>
        )}

        {trial?.rows?.length > 0 && (
          <div style={{ marginTop: 14, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: theme.navy, color: "#fff", textAlign: "start" }}>
                  {["Employee","Basis","Days","Hours","Gross","Commission","Reports","Deductions","Net"].map((h) => (
                    <th key={h} style={{ padding: "7px 9px", whiteSpace: "nowrap" }}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trial.rows.map((r) => (
                  <tr key={r.employee_id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "7px 9px" }}>
                      <div style={{ fontWeight: 700, color: theme.navy }}>{r.employee_name}</div>
                      {r.flags && <div style={{ color: "#a97c00", fontSize: 11, marginTop: 2 }}>{t(r.flags)}</div>}
                    </td>
                    <td style={{ padding: "7px 9px" }}>{tCode(r.pay_basis)}</td>
                    <td style={{ padding: "7px 9px" }}>{r.paid_days}</td>
                    <td style={{ padding: "7px 9px" }}>{Number(r.paid_hours).toFixed(1)}</td>
                    <td style={{ padding: "7px 9px" }}>{formatMoney(r.gross)}</td>
                    <td style={{ padding: "7px 9px" }}>{formatMoney(r.scan_commission)}</td>
                    <td style={{ padding: "7px 9px" }}>{formatMoney(r.report_bonus)}</td>
                    <td style={{ padding: "7px 9px", color: "#ba1a1a" }}>
                      {formatMoney(Number(r.rule_deductions) + Number(r.penalty_deductions) +
                                   Number(r.advance_taken) + Number(r.tab_taken) + Number(r.cash_swept))}
                    </td>
                    <td style={{ padding: "7px 9px", fontWeight: 800, color: theme.navy }}>{formatMoney(r.indicative_net)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#F4F6F9", fontWeight: 800 }}>
                  <td style={{ padding: "8px 9px" }} colSpan={8}>{t("Total payroll for {period}", { period: trial.period })}</td>
                  <td style={{ padding: "8px 9px", color: theme.navy }}>
                    {formatMoney(trial.rows.reduce((t, r) => t + Number(r.indicative_net), 0))} {t("EGP")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading && <p style={{ color: theme.gray }}>{t("Loading...")}</p>}

      {slip && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
            {[
              { l: slip.payBasis === "hybrid" ? "Shifts + commission" : "Base pay", v: `${formatMoney(slip.basePay)} ${t("EGP")}`, c: theme.navy },
              { l: "Bonuses", v: `+${formatMoney(slip.totalBonuses)}`, c: "#1e7a3c" },
              { l: "Deductions", v: `−${formatMoney(slip.totalDeductions)}`, c: "#ba1a1a" },
              { l: "Net pay", v: `${formatMoney(slip.net)} ${t("EGP")}`, c: theme.gold },
            ].map((k) => (
              <div key={k.l} style={card}>
                <div style={{ fontSize: 10, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{t(k.l)}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: k.c }}>{k.v}</div>
              </div>
            ))}
          </div>

          <div style={{ ...card, marginBottom: 18 }}>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>
              {t("How the base pay was reached")}
              <span style={{ fontSize: 11, fontWeight: 400, color: theme.gray, marginInlineStart: 8 }}>
                {slip.payBasis === "hourly" ? t("Hourly · {rate} EGP/hr", { rate: formatMoney(slip.hourlyRate) }) : t("Monthly salary")}
              </span>
            </h3>
            {slip.payBasis === "hourly" ? (
              <p style={{ fontSize: 13, color: theme.navy, margin: "0 0 10px" }}>
                {t("{paid} of {scheduled} scheduled days confirmed", { paid: slip.paidDays, scheduled: slip.scheduledDays })} · {t("{n} hours", { n: slip.paidHours.toFixed(1) })} ×{" "}
                {formatMoney(slip.hourlyRate)} = <strong>{formatMoney(slip.basePay)} {t("EGP")}</strong>
              </p>
            ) : (
              <p style={{ fontSize: 13, color: theme.navy, margin: "0 0 10px" }}>
                {t("Fixed monthly salary of {amount} EGP. Attendance does not reduce it directly — an unworked day reaches the payslip as a deduction below, so it is always visible why.", { amount: formatMoney(slip.basePay) })}
              </p>
            )}
            {slip.needsReview > 0 && (
              <p style={{ fontSize: 12, color: "#a97c00", fontWeight: 700, margin: 0 }}>
                {slip.needsReview === 1
                  ? t("1 day signed in with no sign-out — waiting on an admin in the Action Center. Not paid or unpaid until decided.")
                  : t("{n} days signed in with no sign-out — waiting on an admin in the Action Center. Not paid or unpaid until decided.", { n: slip.needsReview })}
              </p>
            )}
          </div>

          {(slip.reportBonus > 0 || slip.scanCommission > 0 || slip.rawDataBonus > 0) && (
            <div style={{ ...card, marginBottom: 18 }}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Earned on top of the shift")}</h3>
              {slip.scanCommission > 0 && (
                <p style={{ fontSize: 13, color: theme.navy, margin: "0 0 8px" }}>
                  <strong>{t("Scan commission {amount} EGP", { amount: formatMoney(slip.scanCommission) })}</strong>{" "}
                  {slip.commissionDays === 1 ? t("across 1 day.") : t("across {n} days.", { n: slip.commissionDays })}{" "}
                  {t("Calculated on what the patient actually paid after discount, and only once the visit is settled.")}
                </p>
              )}
              {slip.reportBonus > 0 && (
                <p style={{ fontSize: 13, color: theme.navy, margin: 0 }}>
                  <strong>{t("Report bonus {amount} EGP", { amount: formatMoney(slip.reportBonus) })}</strong> —{" "}
                  {t("{q} of {total} reports qualified (average {rate} each; rate depends on scan type).", { q: slip.reportsQualifying, total: slip.reportsTotal, rate: formatMoney(slip.reportRate) })}{" "}
                  {t("{beyond} past the daily count, {off} finished off shift.", { beyond: slip.reportsBeyondThreshold, off: slip.reportsOffShift })}
                  {slip.reportsBeyondThreshold + slip.reportsOffShift > slip.reportsQualifying &&
                    " " + t("Reports meeting both only count once.")}
                </p>
              )}
              {slip.rawDataBonus > 0 && (
                <p style={{ fontSize: 13, color: theme.navy, margin: "8px 0 0" }}>
                  <strong>{t("Raw data bonus {amount} EGP", { amount: formatMoney(slip.rawDataBonus) })}</strong> —{" "}
                  {t("{q} of {total} uploaded scans earn a bonus (rate per scan type, set on the employee profile).", { q: slip.rawDataQualifying, total: slip.rawDataUploads })}
                </p>
              )}
            </div>
          )}

          {slip.month && (
            <div style={{ ...card, marginBottom: 18 }}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>
                {t("Time balance this month")}
                <span style={{ fontSize: 11, fontWeight: 400, color: theme.gray, marginInlineStart: 8 }}>
                  {t("Every minute counts, no grace. Early arrival and staying late count up to 60 min each per day.")}
                </span>
              </h3>
              {slip.attendanceExempt ? (
                <p style={{ fontSize: 13, color: theme.navy, margin: 0 }}>
                  {t("Attendance-exempt (no clock). Paid the expected base with no attendance items.")}
                </p>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, fontSize: 13, color: theme.navy }}>
                    <div><div style={{ fontSize: 10, color: theme.gray, fontWeight: 700 }}>{t("LATE")}</div><span style={{ color: "#ba1a1a" }}><Ltr>−{slip.month.late_minutes}</Ltr> {t("min")}</span></div>
                    <div><div style={{ fontSize: 10, color: theme.gray, fontWeight: 700 }}>{t("LEFT EARLY")}</div><span style={{ color: "#ba1a1a" }}><Ltr>−{slip.month.early_leave_minutes}</Ltr> {t("min")}</span></div>
                    <div><div style={{ fontSize: 10, color: theme.gray, fontWeight: 700 }}>{t("EARLY + STAYED LATE")}</div><span style={{ color: "#1e7a3c" }}><Ltr>+{slip.month.credit_minutes}</Ltr> {t("min")}</span></div>
                    <div><div style={{ fontSize: 10, color: theme.gray, fontWeight: 700 }}>{t("OFF-ROSTER DAYS")}</div><span style={{ color: "#1e7a3c" }}><Ltr>+{slip.month.extra_minutes}</Ltr> {t("min")}</span>{Number(slip.month.extra_days) > 0 ? ` (${t("{n} d", { n: slip.month.extra_days })})` : ""}</div>
                    <div><div style={{ fontSize: 10, color: theme.gray, fontWeight: 700 }}>{t("NET BALANCE")}</div><strong style={{ color: Number(slip.month.net_minutes) < 0 ? "#ba1a1a" : "#1e7a3c" }}><Ltr>{Number(slip.month.net_minutes) > 0 ? "+" : ""}{slip.month.net_minutes}</Ltr> {t("min")}</strong></div>
                    <div><div style={{ fontSize: 10, color: theme.gray, fontWeight: 700 }}>{Number(slip.month.net_minutes) < 0 ? t("DEDUCTION ×2") : t("OVERTIME ×2")}</div><strong style={{ color: Number(slip.month.time_value) < 0 ? "#ba1a1a" : "#1e7a3c" }}>{formatMoney(Math.abs(Number(slip.month.time_value)))} {t("EGP")}</strong></div>
                  </div>
                  <p style={{ fontSize: 12, color: theme.gray, margin: "10px 0 0" }}>
                    {t("Expected pay:")} <strong style={{ color: theme.navy }}>{formatMoney(slip.month.base)} {t("EGP")}</strong>
                    {Number(slip.month.manual_adjustments) !== 0 && <> ({t("manual items {amount}", { amount: formatMoney(slip.month.manual_adjustments) })})</>}.
                    {Number(slip.month.absent_days) > 0 && " " + t("Absent: {dates}, {amount} EGP (2 days each, 1 with an approved permission).", { dates: slip.month.absent_dates, amount: formatMoney(slip.month.absence_deduction) })}
                    {slip.month.perfect_attendance && " " + t("Perfect attendance: {amount} EGP proposed ({pct}%).", { amount: formatMoney(slip.month.perfect_attendance_bonus), pct: Number(slip.month.perfect_attendance_pct) })}
                    {Number(slip.month.needs_review_days) > 0 && " " + t("{n} day(s) with no sign-out: {dates}.", { n: slip.month.needs_review_days, dates: slip.month.needs_review_dates })}
                    {!slip.month.month_complete && " " + t("The month is still running, so these figures move until the last day.")}
                    {" "}{t("Nothing here reaches the payslip until it is approved.")}
                  </p>
                  {slip.pendingDeductions.length > 0 && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#fff8e1", fontSize: 12, color: "#6b5200" }}>
                      <strong>{t("Waiting for approval in Deductions:")}</strong>{" "}
                      {slip.pendingDeductions.map((d) => `${d.kind === "late" ? t("time balance") : tCode(d.kind)} ${formatMoney(d.amount)} ${t("EGP")}`).join(" · ")}.{" "}
                      <a href="/dashboard/hr/deductions" style={{ color: theme.navy, fontWeight: 700 }}>{t("Open Deductions")}</a>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {(slip.overtimeHours > 0 || slip.overtimeDecision) && (
            <div style={{ ...card, marginBottom: 18, borderInlineStart: `4px solid ${theme.gold}` }}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>
                {t("Overtime")}
                <span style={{ fontSize: 11, fontWeight: 400, color: theme.gray, marginInlineStart: 8 }}>
                  {t("Hours worked beyond the schedule. Never paid automatically.")}
                </span>
              </h3>

              {slip.overtimeDecision ? (
                <div style={{ fontSize: 13, color: theme.navy }}>
                  {slip.overtimeDecision.status === "approved" ? (
                    <p style={{ margin: "0 0 6px" }}>
                      <strong>{t("{n} h approved", { n: Number(slip.overtimeDecision.hours_approved).toFixed(2) })}</strong>{" "}
                      {t("at {amount} EGP, added as a bonus below.", { amount: formatMoney(slip.overtimeDecision.amount) })}
                    </p>
                  ) : (
                    <p style={{ margin: "0 0 6px" }}>
                      <strong>{t("Waived.")}</strong> {t("{n} h were recorded and deliberately not paid.", { n: Number(slip.overtimeHours).toFixed(2) })}
                    </p>
                  )}
                  <p style={{ margin: 0, fontSize: 12, color: theme.gray }}>
                    {t("Decided by {name}", { name: slip.overtimeDecision.decided_by })}
                    {slip.overtimeDecision.note ? ` · ${slip.overtimeDecision.note}` : ""}
                  </p>
                  <button onClick={reopenOvertime} disabled={otBusy}
                    style={{ marginTop: 10, background: "transparent", color: theme.navy, border: `1px solid ${theme.gray}`,
                             borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                    {t("Reopen")}
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: theme.navy, margin: "0 0 10px" }}>
                    <strong>{t("{n} hours", { n: Number(slip.overtimeHours).toFixed(2) })}</strong> {t("recorded beyond the schedule.")}{" "}
                    {t("Net balance × minute rate × 2 =")} <strong>{formatMoney(slip.overtimeIndicativeValue)} {t("EGP")}</strong>.{" "}
                    {t("Approve as is, or type a different amount.")}
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input type="number" step="0.01" placeholder={t("Hours (max {n})", { n: Number(slip.overtimeHours).toFixed(2) })}
                      value={otHours} onChange={(e) => setOtHours(e.target.value)}
                      style={{ ...inp, width: 170 }} />
                    <input type="number" step="0.01" placeholder={`${formatMoney(slip.overtimeIndicativeValue)} ${t("EGP")}`}
                      value={otAmount} onChange={(e) => setOtAmount(e.target.value)}
                      style={{ ...inp, width: 150 }} />
                    <input type="text" placeholder={t("Reason (optional)")}
                      value={otNote} onChange={(e) => setOtNote(e.target.value)}
                      style={{ ...inp, flex: 1, minWidth: 180 }} />
                    <button onClick={() => decideOvertime("approved")} disabled={otBusy}
                      style={{ background: theme.navy, color: "#fff", border: "none", borderRadius: 8,
                               padding: "9px 16px", fontWeight: 700, cursor: "pointer", opacity: otBusy ? 0.5 : 1 }}>
                      {t("Approve")}
                    </button>
                    <button onClick={() => decideOvertime("waived")} disabled={otBusy}
                      style={{ background: "transparent", color: theme.navy, border: `1px solid ${theme.gray}`,
                               borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: "pointer" }}>
                      {t("Waive")}
                    </button>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: theme.gray }}>
                    {t("Waiving still records the decision and who made it, so unpaid overtime is always a choice someone made rather than something that quietly disappeared.")}
                  </p>
                </>
              )}
            </div>
          )}

          {slip.penaltyDeferred > 0 && (
            <div style={{ ...card, marginBottom: 18, borderInlineStart: "4px solid #ba1a1a" }}>
              <strong style={{ color: "#ba1a1a" }}>{t("{amount} EGP of approved deductions move to next month.", { amount: formatMoney(slip.penaltyDeferred) })}</strong>
              <p style={{ fontSize: 12, color: theme.gray, margin: "6px 0 0" }}>
                {t("The deduction cap is {pct}% of this month's pay, and a deduction that does not fit moves whole to next month. The net pay above already reflects this. Change the cap on HR Rules (100 = always apply in full).", { pct: slip.penaltyCapPercent })}
              </p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }}>
            <div style={card}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Adjustments this month")}</h3>
              {[...slip.bonuses, ...slip.deductions].length === 0 && (
                <p style={{ fontSize: 13, color: theme.gray }}>{t("Nothing applied.")}</p>
              )}
              {[...slip.bonuses, ...slip.deductions].map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f2f2f2" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>
                      {t(a.label)}
                      {ADJ_STATUS[a.status] && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, marginInlineStart: 8,
                                       background: ADJ_STATUS[a.status].bg, color: ADJ_STATUS[a.status].fg }}>
                          {t(ADJ_STATUS[a.status].label)}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: theme.gray }}>
                      {a.occurred_on || "—"}{a.note ? ` · ${a.note}` : ""}{a.created_by_name ? ` · ${t("by {name}", { name: a.created_by_name })}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 800, color: a.kind === "bonus" ? "#1e7a3c" : "#ba1a1a" }}>
                      {a.kind === "bonus" ? "+" : "−"}{formatMoney(a.amount)}
                    </span>
                    {a.status === "pending" && (
                      <>
                        <button onClick={() => decideAdjustment(a, "approved")}
                          style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: theme.navy, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          {t("Approve")}
                        </button>
                        <button onClick={() => decideAdjustment(a, "rejected")}
                          style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          {t("Reject")}
                        </button>
                      </>
                    )}
                    <button onClick={() => removeAdjustment(a.id)}
                      style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: "#ba1a1a", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {t("Remove")}
                    </button>
                  </div>
                </div>
              ))}

              <div style={{ background: "#faf9fb", borderRadius: 10, padding: 12, marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#48464E", marginBottom: 8 }}>{t("Apply a rule")}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select style={{ ...inp, flex: 1, minWidth: 160 }} value={apply.ruleId}
                    onChange={(e) => setApply({ ...apply, ruleId: e.target.value })}>
                    <option value="">{t("Choose a rule...")}</option>
                    {rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.kind === "bonus" ? "＋ " : "− "}{r.name} ({r.rule_type === "fixed" ? t("{value} EGP", { value: r.value }) : r.rule_type === "day_multiplier" ? t("{value} days", { value: r.value }) : `${r.value}%`})
                      </option>
                    ))}
                  </select>
                  <input type="date" style={{ ...inp, width: 150 }} value={apply.occurredOn}
                    onChange={(e) => setApply({ ...apply, occurredOn: e.target.value })} />
                  <input style={{ ...inp, width: 110 }} value={apply.amountOverride} placeholder={t("override EGP")}
                    onChange={(e) => setApply({ ...apply, amountOverride: e.target.value })} />
                  <input style={{ ...inp, flex: 1, minWidth: 140 }} value={apply.note} placeholder={t("Note (optional)")}
                    onChange={(e) => setApply({ ...apply, note: e.target.value })} />
                  <button onClick={addAdjustment}
                    style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    {t("Apply")}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: theme.gray, margin: "8px 0 0" }}>
                  {t("The date matters for \"days of pay\" rules — a day is worth that day's scheduled hours. The amount is fixed when applied, so editing the rule later never changes this payslip.")}
                </p>
              </div>
            </div>

            <div style={card}>
              <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Attendance")}</h3>
              {slip.days.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>{t("No attendance recorded this month.")}</p>}
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {slip.days.map((d) => {
                  const st = STATUS[d.status] || { bg: "#f2f2f2", fg: "#777", label: d.status };
                  const bits = [
                    d.signedIn && `${d.signedIn}–${d.signedOut || "?"}`,
                    d.late > 0 && t("late {n}m", { n: d.late }),
                    d.leftEarly > 0 && t("left early {n}m", { n: d.leftEarly }),
                    d.early > 0 && t("early {n}m", { n: Math.min(d.early, 60) }),
                    d.after > 0 && t("stayed {n}m", { n: Math.min(d.after, 60) }),
                  ].filter(Boolean).join(" · ");
                  return (
                    <div key={d.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
                      <span style={{ fontSize: 12, color: theme.navy }}>
                        {new Date(d.date + "T00:00:00").toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short" })}
                        <span style={{ color: theme.gray }}> · {t("{n}h", { n: d.hours.toFixed(1) })}{bits ? ` · ${bits}` : ""}</span>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.fg }}>
                        {STATUS[d.status] ? t(st.label) : tCode(d.status)}
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
