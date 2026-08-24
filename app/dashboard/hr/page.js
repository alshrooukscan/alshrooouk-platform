"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { exportToCsv } from "../../../lib/exportCsv";
import { logActivity } from "../../../lib/activityLog";

export default function HRPage() {
  const { isAdmin, profile } = usePermissions();
  const [employees, setEmployees] = useState([]);
  const [deductionRules, setDeductionRules] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loginAsBusy, setLoginAsBusy] = useState(null);
  const [showAddDeduction, setShowAddDeduction] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const [{ data: emps }, { data: rules }] = await Promise.all([
      supabase.from("employees").select("id, name, hr_id, role, is_active").order("created_at", { ascending: false }),
      supabase.from("deduction_rules").select("id, name, value").order("name"),
    ]);
    setEmployees(emps || []);
    setDeductionRules(rules || []);
    setLoading(false);
  }

  const filtered = employees.filter(
    (e) => e.name?.toLowerCase().includes(query.toLowerCase()) || e.hr_id?.toLowerCase().includes(query.toLowerCase())
  );

  async function handleLoginAs(employee) {
    setLoginAsBusy(employee.id);
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/login-as", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ type: "employee", id: employee.id }),
    });
    const result = await res.json();
    setLoginAsBusy(null);
    if (result.redirect) window.open(result.redirect, "_blank");
    else alert(result.error || "Could not log in as this employee");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ color: theme.navy, margin: 0 }}>Human Resources</h1>
          <p style={{ color: theme.gray, margin: "4px 0 0" }}>Manage clinic staff, salaries, and payslips.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => exportToCsv("employees.csv", filtered.map((e) => ({ Name: e.name, "HR ID": e.hr_id, Role: e.role || "", Status: e.is_active ? "Active" : "Inactive" })))}
            style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 14 }}
          >
            Export CSV
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowAddDeduction(true)}
              style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" }}
            >
              + Add Deduction
            </button>
          )}
          <Link
            href="/dashboard/hr/new"
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
              color: theme.navy,
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
              whiteSpace: "nowrap",
            }}
          >
            + Add Employee
          </Link>
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, ID, or role..."
        style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 20, boxSizing: "border-box" }}
      />

      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#faf9fb", textAlign: "left" }}>
              <th style={th}>Employee</th>
              <th style={th}>HR ID</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                <td style={td}>
                  <Link href={`/dashboard/hr/${e.id}`} style={{ color: theme.navy, fontWeight: 600, textDecoration: "none" }}>
                    {e.name}
                  </Link>
                </td>
                <td style={td}>{e.hr_id}</td>
                <td style={td}>{e.role || "—"}</td>
                <td style={td}>
                  <span
                    style={{
                      padding: "2px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      background: e.is_active ? "#e8f5e9" : "#f0f0f0",
                      color: e.is_active ? "#2e7d32" : "#888",
                    }}
                  >
                    {e.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={td}>
                  {isAdmin && (
                    <button
                      onClick={() => handleLoginAs(e)}
                      disabled={loginAsBusy === e.id}
                      style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                    >
                      {loginAsBusy === e.id ? "..." : "Login As"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: theme.gray }}>No employees yet.</div>
        )}
      </div>

      {showAddDeduction && (
        <AddDeductionModal
          employees={employees}
          deductionRules={deductionRules}
          profile={profile}
          onClose={() => setShowAddDeduction(false)}
        />
      )}
    </div>
  );
}

function AddDeductionModal({ employees, deductionRules, profile, onClose }) {
  const [ruleId, setRuleId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const selectedRule = deductionRules.find((r) => r.id === ruleId);

  function handleRuleChange(id) {
    setRuleId(id);
    const rule = deductionRules.find((r) => r.id === id);
    // Pre-fill with the rule's standard value, but it stays editable per instance.
    if (rule) setAmount(String(rule.value));
  }

  async function handleSave() {
    setError("");
    if (!ruleId) {
      setError("Select a deduction type.");
      return;
    }
    if (!employeeId) {
      setError("Select an employee.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("employee_rule_assignments")
      .insert({
        employee_id: employeeId,
        deduction_rule_id: ruleId,
        amount: Number(amount),
        note: note || null,
        created_by_name: profile?.name || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    const employee = employees.find((e) => e.id === employeeId);
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: "added_deduction",
      entityType: "employee_rule_assignment",
      entityId: data.id,
      details: { employeeName: employee?.name, ruleName: selectedRule?.name, amount: Number(amount) },
    });
    setDone(true);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 400, maxWidth: "90vw" }}>
        {done ? (
          <>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>Deduction Added</h3>
            <p style={{ fontSize: 13, color: theme.gray }}>
              This will be applied the next time payroll is generated for this employee.
            </p>
            <button onClick={onClose} style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              Close
            </button>
          </>
        ) : (
          <>
            <h3 style={{ color: theme.navy, marginTop: 0 }}>Add Deduction</h3>
            <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
              Applies once, at this employee's next payroll run.
            </p>

            <label style={fieldLabel}>Deduction Type</label>
            <select value={ruleId} onChange={(e) => handleRuleChange(e.target.value)} style={modalInp}>
              <option value="">Select deduction type...</option>
              {deductionRules.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {deductionRules.length === 0 && (
              <p style={{ fontSize: 11, color: theme.gray, marginTop: -8, marginBottom: 16 }}>
                No deduction types yet - add one first in Settings &gt; Deduction Rules.
              </p>
            )}

            <label style={fieldLabel}>Employee</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={modalInp}>
              <option value="">Select employee...</option>
              {employees.filter((e) => e.is_active).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>

            <label style={fieldLabel}>Amount (EGP)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={modalInp} placeholder="0.00" />

            <label style={fieldLabel}>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} style={modalInp} placeholder="e.g. reason for this deduction" />

            {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Saving..." : "Add Deduction"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const th = { padding: "12px 16px", fontSize: 11, color: "#48464E", fontWeight: 700, textTransform: "uppercase" };
const td = { padding: "12px 16px" };
const fieldLabel = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginTop: 12, marginBottom: 4 };
const modalInp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
