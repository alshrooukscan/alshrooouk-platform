"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { usePermissions } from "../../../../lib/usePermissions";
import { logActivity } from "../../../../lib/activityLog";

export default function DeductionsAndExcusesPage() {
  const { profile } = usePermissions();
  const [deductionRules, setDeductionRules] = useState([]);
  const [excuseRules, setExcuseRules] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [newDeduction, setNewDeduction] = useState({ name: "", value: "" });
  const [newExcuse, setNewExcuse] = useState({ name: "" });
  const [statusFilter, setStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: d }, { data: e }, { data: s }] = await Promise.all([
      supabase.from("deduction_rules").select("*").order("created_at"),
      supabase.from("excuse_rules").select("*").order("created_at"),
      supabase.from("excuse_submissions").select("*, employees(name, hr_id), excuse_rules(name)").order("created_at", { ascending: false }),
    ]);
    setDeductionRules(d || []);
    setExcuseRules(e || []);
    setSubmissions(s || []);
    setLoading(false);
  }

  async function addDeduction() {
    if (!newDeduction.name) return;
    await supabase.from("deduction_rules").insert({ name: newDeduction.name, value: newDeduction.value || 0, rule_type: "fixed" });
    setNewDeduction({ name: "", value: "" });
    loadAll();
  }

  async function updateDeductionValue(rule, value) {
    await supabase.from("deduction_rules").update({ value }).eq("id", rule.id);
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

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>
        <Link href="/dashboard/hr" style={{ color: theme.gray }}>HR Management</Link> &gt; Deductions and Excuses
      </p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Deductions and Excuses</h1>
      <p style={{ color: theme.gray, margin: "0 0 24px" }}>Configure the rule types used across payroll, and review excuses employees submit.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div style={cardStyle}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Deduction Rules</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>
            Editing a rule's value here changes the next payslip generated for any employee assigned to it.
          </p>
          {deductionRules.map((r) => (
            <div key={r.id} style={row}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{r.name}</span>
              <input style={{ ...inp, width: 100, marginBottom: 0 }} defaultValue={r.value} onBlur={(e) => updateDeductionValue(r, e.target.value)} />
            </div>
          ))}
          {deductionRules.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>No deduction rules yet.</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input style={inp} value={newDeduction.name} onChange={(e) => setNewDeduction({ ...newDeduction, name: e.target.value })} placeholder="Rule name (e.g., Late Arrival)" />
            <input style={{ ...inp, width: 90 }} value={newDeduction.value} onChange={(e) => setNewDeduction({ ...newDeduction, value: e.target.value })} placeholder="EGP" />
            <button onClick={addDeduction} style={smallPrimary}>+ Add</button>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Excuse / Absence Rules</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>
            These are the types employees can pick from when submitting an excuse in their portal.
          </p>
          {excuseRules.map((r) => (
            <div key={r.id} style={row}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{r.name}</span>
            </div>
          ))}
          {excuseRules.length === 0 && <p style={{ fontSize: 13, color: theme.gray }}>No excuse rules yet.</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input style={inp} value={newExcuse.name} onChange={(e) => setNewExcuse({ name: e.target.value })} placeholder="Rule name (e.g., Sick Leave)" />
            <button onClick={addExcuse} style={smallPrimary}>+ Add</button>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ color: theme.navy, margin: 0 }}>
            Submitted Excuses {pendingCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#a97c00" }}>({pendingCount} pending)</span>}
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
                {s}
              </button>
            ))}
          </div>
        </div>

        {!loading && filteredSubmissions.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No {statusFilter !== "all" ? statusFilter : ""} excuse submissions.</p>}

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
                {s.status}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                  <Link href={`/dashboard/hr/${s.employee_id}`} style={{ color: theme.navy, textDecoration: "none" }}>{s.employees?.name}</Link>
                  {" \u00b7 "}
                  <span style={{ fontWeight: 500 }}>{s.excuse_rules?.name || "Excuse"}</span>
                </div>
                {s.note && <div style={{ fontSize: 12, color: theme.gray }}>{s.note}</div>}
                <div style={{ fontSize: 11, color: theme.gray }}>{new Date(s.created_at).toLocaleDateString()}</div>
              </div>
              {s.status === "pending" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => reviewSubmission(s, "approved")} disabled={busyId === s.id} style={{ ...smallBtn, background: "#2e7d32", color: "#fff", border: "none" }}>
                    Approve
                  </button>
                  <button onClick={() => reviewSubmission(s, "rejected")} disabled={busyId === s.id} style={smallBtn}>
                    Reject
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
