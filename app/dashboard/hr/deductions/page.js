"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { usePermissions } from "../../../../lib/usePermissions";
import { logActivity } from "../../../../lib/activityLog";
import { useT, tx, Ltr } from "../../../../lib/i18n";

export default function DeductionsAndExcusesPage() {
  const { t, tCode, isAr } = useT();
  const { profile } = usePermissions();
  const [deductionRules, setDeductionRules] = useState([]);
  const [excuseRules, setExcuseRules] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [ruleForm, setRuleForm] = useState({ id: null, name: "", kind: "deduction", ruleType: "fixed", value: "", description: "" });
  const [ruleError, setRuleError] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [newExcuse, setNewExcuse] = useState({ name: "" });
  const [statusFilter, setStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [queue, setQueue] = useState([]);
  const [dedSettings, setDedSettings] = useState(null);
  const [queueBusy, setQueueBusy] = useState(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: d }, { data: e }, { data: s }] = await Promise.all([
      supabase.from("deduction_rules").select("*").order("kind").order("name"),
      supabase.from("excuse_rules").select("*").order("created_at"),
      supabase.from("excuse_submissions").select("*, employees(name, hr_id), excuse_rules(name)").order("created_at", { ascending: false }),
    ]);
    setDeductionRules(d || []);
    setExcuseRules(e || []);
    setSubmissions(s || []);
    setLoading(false);
  }

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function saveRule() {
    setRuleError("");
    if (!ruleForm.name.trim()) return setRuleError("Give the rule a name.");
    if (!ruleForm.value || Number(ruleForm.value) <= 0) return setRuleError("Enter a value greater than zero.");
    setSavingRule(true);
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "save_rule", ...ruleForm }),
    });
    const j = await res.json();
    setSavingRule(false);
    if (!res.ok) return setRuleError(j.error || "Could not save that rule.");
    setRuleForm({ id: null, name: "", kind: "deduction", ruleType: "fixed", value: "", description: "" });
    loadAll();
  }

  async function deleteRule(rule) {
    if (!confirm(tx("Delete \"{name}\"?", { name: rule.name }))) return;
    const res = await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "delete_rule", id: rule.id }),
    });
    const j = await res.json();
    // A rule that has already been applied is deactivated instead, so an old
    // payslip can still explain where its figure came from.
    if (!res.ok) return alert(tx(j.error));
    loadAll();
  }

  async function toggleRule(rule) {
    await fetch("/api/hr/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "retire_rule", id: rule.id, active: !rule.is_active }),
    });
    loadAll();
  }

  async function addExcuse() {
    if (!newExcuse.name) return;
    await supabase.from("excuse_rules").insert({ name: newExcuse.name, rule_type: "fixed" });
    setNewExcuse({ name: "" });
    loadAll();
  }

  async function reviewSubmission(submission, status) {
    setBusyId(submission.id);
    const { data: session } = await supabase.auth.getSession();
    await supabase
      .from("excuse_submissions")
      .update({ status, reviewed_by: session.session?.user?.id || null, reviewed_at: new Date().toISOString() })
      .eq("id", submission.id);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: `excuse_${status}`,
      entityType: "excuse_submission",
      entityId: submission.id,
      details: { employeeName: submission.employees?.name, excuseType: submission.excuse_rules?.name },
    });
    await loadAll();
    setBusyId(null);
  }

  const filteredSubmissions = statusFilter === "all" ? submissions : submissions.filter((s) => s.status === statusFilter);
  const pendingCount = submissions.filter((s) => s.status === "pending").length;


  async function loadQueue() {
    const res = await fetch("/api/hr/deductions?status=pending", {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    if (!res.ok) return;
    const j = await res.json();
    setQueue(j.deductions || []);
    setDedSettings(j.settings || null);
  }

  useEffect(() => { loadQueue(); }, []);

  async function runDetectors() {
    setDetecting(true);
    const res = await fetch("/api/hr/deductions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "detect" }),
    });
    const j = await res.json().catch(() => ({}));
    setDetecting(false);
    if (!res.ok) { alert(tx(j.error || "Could not run the check.")); return; }
    loadQueue();
  }

  async function decideDeduction(row, status) {
    const note = window.prompt(
      status === "approved"
        ? tx("Approving {amount} EGP against {name}. Add a note for the record (optional).", { amount: Number(row.amount).toFixed(2), name: row.employee_name })
        : tx("Rejecting this deduction. Why? (optional)"),
      ""
    );
    if (note === null) return;
    setQueueBusy(row.id);
    const res = await fetch("/api/hr/deductions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ action: "decide", id: row.id, status, note: note || null }),
    });
    const j = await res.json().catch(() => ({}));
    setQueueBusy(null);
    if (!res.ok) { alert(tx(j.error || "Could not save that decision.")); return; }
    loadQueue();
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>
        <Link href="/dashboard/hr" style={{ color: theme.gray }}>{t("HR Management")}</Link> {isAr ? "<" : ">"} {t("Deductions and Excuses")}
      </p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>{t("Deductions and Excuses")}</h1>
      <p style={{ color: theme.gray, margin: "0 0 24px" }}>{t("Configure the rule types used across payroll, and review excuses employees submit.")}</p>

      <div style={{ ...cardStyle, marginBottom: 20, borderInlineStart: `4px solid ${theme.gold}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ color: theme.navy, margin: 0 }}>{t("Detected Deductions")}</h3>
            <p style={{ fontSize: 12, color: theme.gray, margin: "4px 0 0", maxWidth: 620 }}>
              {t("Unconfirmed card payments, stock shortfalls and short-notice leave, found automatically. Nothing here has cost anyone anything yet. Approving a line is what puts it on a payslip, and your name goes on it.")}
            </p>
          </div>
          <button onClick={runDetectors} disabled={detecting}
            style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${theme.navy}`,
                     background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer",
                     opacity: detecting ? 0.5 : 1 }}>
            {detecting ? t("Checking...") : t("Run check")}
          </button>
        </div>

        {!dedSettings?.deduction_go_live && (
          <p style={{ marginTop: 14, marginBottom: 0, padding: 12, borderRadius: 8, background: "#FBF7EF",
                      fontSize: 13, color: theme.navy }}>
            <strong>{t("The engine is off.")}</strong> {t("No start date is set, so nothing is being detected against anyone. An admin sets that date when the clinic is ready to begin. Until then this stays empty on purpose.")}
          </p>
        )}

        {dedSettings?.deduction_go_live && queue.length === 0 && (
          <p style={{ marginTop: 14, marginBottom: 0, fontSize: 13, color: theme.gray }}>
            {t("Nothing waiting. Running since {date}.", { date: dedSettings.deduction_go_live })}
          </p>
        )}

        {queue.length > 0 && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {queue.map((row) => (
              <div key={row.id} style={{ border: "1px solid #e6e6ea", borderRadius: 10, padding: 12,
                                         display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: theme.navy }}>
                    {row.employee_name}
                    <span style={{ fontWeight: 400, color: theme.gray, fontSize: 12, marginInlineStart: 8 }}>
                      {row.hr_id} · {row.period} · {tCode(row.kind)}
                    </span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: theme.navy }}>{t(row.reason)}</p>
                  {row.acknowledgement_on_file === false && (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#a97c00", fontWeight: 600 }}>
                      {t("This employee has not signed the pay and deduction acknowledgement.")}
                    </p>
                  )}
                </div>
                <div style={{ textAlign: "end" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#ba1a1a", marginBottom: 8 }}>
                    <Ltr>−{Number(row.amount).toFixed(2)}</Ltr> {t("EGP")}
                  </div>
                  <button onClick={() => decideDeduction(row, "approved")} disabled={queueBusy === row.id}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: theme.navy,
                             color: "#fff", fontWeight: 700, cursor: "pointer", marginInlineEnd: 6 }}>
                    {t("Approve")}
                  </button>
                  <button onClick={() => decideDeduction(row, "rejected")} disabled={queueBusy === row.id}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff",
                             color: theme.navy, fontWeight: 700, cursor: "pointer" }}>
                    {t("Reject")}
                  </button>
                </div>
              </div>
            ))}
            <p style={{ margin: 0, fontSize: 12, color: theme.gray }}>
              {t("No payslip loses more than {pct}% of what was earned that month. Anything above the line moves to the next payslip rather than being forgiven or forced through.", { pct: dedSettings?.penalty_cap_percent || 25 })}
            </p>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div style={cardStyle}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Deduction Rules")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>
            {t("A rule is either a flat amount, a number of days' pay, or a percentage of salary. A day is worth the hourly rate times that day's scheduled hours, or the monthly salary divided by 30.")}
          </p>

          {ruleError && <p style={{ color: "#ba1a1a", fontSize: 12 }}>{t(ruleError)}</p>}

          {["deduction", "bonus"].map((kindKey) => {
            const list = deductionRules.filter((r) => (r.kind || "deduction") === kindKey);
            return (
              <div key={kindKey} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: kindKey === "bonus" ? "#1e7a3c" : "#ba1a1a", textTransform: "uppercase", marginBottom: 6 }}>
                  {kindKey === "bonus" ? t("Bonuses") : t("Deductions")}
                </div>
                {list.length === 0 && <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 6px" }}>{t("None yet.")}</p>}
                {list.map((r) => (
                  <div key={r.id} style={{ ...row, opacity: r.is_active === false ? 0.5 : 1 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: theme.navy, fontWeight: 600 }}>{t(r.name)}</span>
                      <span style={{ fontSize: 11, color: theme.gray, marginInlineStart: 8 }}>
                        {r.rule_type === "fixed" && t("{value} EGP", { value: r.value })}
                        {r.rule_type === "day_multiplier" && (Number(r.value) === 1 ? t("{value} day of pay", { value: r.value }) : t("{value} days of pay", { value: r.value }))}
                        {r.rule_type === "percentage" && t("{value}% of salary", { value: r.value })}
                        {r.is_active === false && ` · ${t("inactive")}`}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setRuleForm({ id: r.id, name: r.name, kind: r.kind || "deduction", ruleType: r.rule_type, value: r.value, description: r.description || "" })}
                        style={tinyBtn}>{t("Edit")}</button>
                      <button onClick={() => toggleRule(r)} style={tinyBtn}>{r.is_active === false ? t("Activate") : t("Deactivate")}</button>
                      <button onClick={() => deleteRule(r)} style={{ ...tinyBtn, color: "#ba1a1a" }}>{t("Delete")}</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          <div style={{ background: "#faf9fb", borderRadius: 10, padding: 12, marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#48464E", marginBottom: 8 }}>
              {ruleForm.id ? t("Edit rule") : t("New rule")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input style={{ ...inp, flex: 1, minWidth: 150, marginBottom: 0 }} value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder={t("Name (e.g. Late Arrival)")} />
              <select style={{ ...inp, width: 120, marginBottom: 0 }} value={ruleForm.kind}
                onChange={(e) => setRuleForm({ ...ruleForm, kind: e.target.value })}>
                <option value="deduction">{t("Deduction")}</option>
                <option value="bonus">{t("Bonus")}</option>
              </select>
              <select style={{ ...inp, width: 150, marginBottom: 0 }} value={ruleForm.ruleType}
                onChange={(e) => setRuleForm({ ...ruleForm, ruleType: e.target.value })}>
                <option value="fixed">{t("Fixed amount (EGP)")}</option>
                <option value="day_multiplier">{t("Days of pay")}</option>
                <option value="percentage">{t("% of salary")}</option>
              </select>
              <input style={{ ...inp, width: 90, marginBottom: 0 }} value={ruleForm.value}
                onChange={(e) => setRuleForm({ ...ruleForm, value: e.target.value })}
                placeholder={ruleForm.ruleType === "fixed" ? t("EGP") : ruleForm.ruleType === "day_multiplier" ? t("days") : "%"} />
              <button onClick={saveRule} disabled={savingRule} style={smallPrimary}>
                {savingRule ? t("Saving...") : ruleForm.id ? t("Save") : t("+ Add")}
              </button>
              {ruleForm.id && (
                <button onClick={() => setRuleForm({ id: null, name: "", kind: "deduction", ruleType: "fixed", value: "", description: "" })} style={tinyBtn}>{t("Cancel")}</button>
              )}
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>{t("Excuse / Absence Rules")}</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>
            {t("These are the types employees can pick from when submitting an excuse in their portal.")}
          </p>
          {excuseRules.map((r) => (
            <div key={r.id} style={row}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{t(r.name)}</span>
            </div>
          ))}
          {excuseRules.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>{t("No excuse rules yet.")}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input style={inp} value={newExcuse.name} onChange={(e) => setNewExcuse({ name: e.target.value })} placeholder={t("Rule name (e.g., Sick Leave)")} />
            <button onClick={addExcuse} style={smallPrimary}>{t("+ Add")}</button>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ color: theme.navy, margin: 0 }}>
            {t("Submitted Excuses")} {pendingCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#a97c00" }}>({t("{n} pending", { n: pendingCount })})</span>}
          </h3>
          <div style={{ display: "flex", gap: 6 }}>
            {["pending", "approved", "rejected", "all"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: `1px solid ${statusFilter === s ? theme.gold : "#ddd"}`,
                  background: statusFilter === s ? theme.goldLight : "#fff",
                  color: theme.navy,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {s === "all" ? t("All") : tCode(s)}
              </button>
            ))}
          </div>
        </div>

        {!loading && filteredSubmissions.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>{statusFilter === "pending" ? t("No pending excuse submissions.") : statusFilter === "approved" ? t("No approved excuse submissions.") : statusFilter === "rejected" ? t("No rejected excuse submissions.") : t("No excuse submissions.")}</p>}

        <div style={{ display: "grid", gap: 8 }}>
          {filteredSubmissions.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 999,
                  minWidth: 76,
                  textAlign: "center",
                  background: s.status === "pending" ? "#fff8e1" : s.status === "approved" ? "#e8f5e9" : "#fdecea",
                  color: s.status === "pending" ? "#a97c00" : s.status === "approved" ? "#2e7d32" : "#ba1a1a",
                  textTransform: "capitalize",
                }}
              >
                {tCode(s.status)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                  <Link href={`/dashboard/hr/${s.employee_id}`} style={{ color: theme.navy, textDecoration: "none" }}>{s.employees?.name}</Link>
                  {" \u00b7 "}
                  <span style={{ fontWeight: 500 }}>{s.excuse_rules?.name || t("Excuse")}</span>
                </div>
                {s.note && <div style={{ fontSize: 12, color: theme.gray }}>{s.note}</div>}
                <div style={{ fontSize: 11, color: theme.gray }}>{new Date(s.created_at).toLocaleDateString()}</div>
              </div>
              {s.status === "pending" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => reviewSubmission(s, "approved")} disabled={busyId === s.id} style={{ ...smallBtn, background: "#2e7d32", color: "#fff", border: "none" }}>
                    {t("Approve")}
                  </button>
                  <button onClick={() => reviewSubmission(s, "rejected")} disabled={busyId === s.id} style={smallBtn}>
                    {t("Reject")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const cardStyle = { background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };
const row = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0" };
const inp = { padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, flex: 1 };
const smallPrimary = { padding: "8px 16px", borderRadius: 6, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 };
const smallBtn = { padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, cursor: "pointer", fontWeight: 600 };

const tinyBtn = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#27214D",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
