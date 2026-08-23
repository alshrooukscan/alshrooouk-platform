"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { formatMoney } from "../../../lib/format";
import { usePermissions } from "../../../lib/usePermissions";
import { logActivity } from "../../../lib/activityLog";

const CATEGORIES = [
  { key: "utilities", label: "Utilities (\u0643\u0647\u0631\u0628\u0627\u0621)" },
  { key: "maintenance", label: "Maintenance (\u0635\u064a\u0627\u0646\u0629)" },
  { key: "supplies", label: "Supplies / Misc Purchase (\u0633\u0648\u0628\u0631 \u0645\u0627\u0631\u0643\u062a)" },
  { key: "employee_advance", label: "Employee Advance (\u0633\u0644\u0641\u0629)" },
  { key: "courier", label: "Courier / Rep Cash (\u0627\u0644\u0645\u0646\u062f\u0648\u0628)" },
  { key: "other", label: "Other" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

export default function CashExpensesPage() {
  const { profile, isAdmin } = usePermissions();
  const [expenses, setExpenses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: e } = await supabase
      .from("cash_expenses")
      .select("*, employees(name), branches(name)")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);
    const { data: emp } = await supabase.from("employees").select("id, name").eq("is_active", true).order("name");
    const { data: br } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
    setExpenses(e || []);
    setEmployees(emp || []);
    setBranches(br || []);
    setLoading(false);
  }

  const filtered = categoryFilter ? expenses.filter((e) => e.category === categoryFilter) : expenses;
  const totalShown = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
  const openAdvances = expenses.filter((e) => e.category === "employee_advance" && e.advance_status === "open");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <p style={{ color: theme.gold, fontSize: 12, fontWeight: 700, letterSpacing: 1, margin: 0 }}>FINANCIAL</p>
          <h1 style={{ color: theme.navy, margin: "4px 0" }}>Cash Expenses</h1>
          <p style={{ color: theme.gray, margin: 0 }}>Real categorized cash out, so Cash In can be measured against what's actually spent.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{ padding: "10px 20px", borderRadius: 8, background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`, color: theme.navy, fontWeight: 700, border: "none", cursor: "pointer", fontSize: 14 }}
        >
          + Log Expense
        </button>
      </div>

      {openAdvances.length > 0 && (
        <div style={{ background: "#fff8e1", border: "1px solid #f0d98c", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: theme.navy, fontSize: 13, marginBottom: 8 }}>{openAdvances.length} open advance{openAdvances.length > 1 ? "s" : ""} being repaid through payroll</div>
          {openAdvances.map((a) => (
            <div key={a.id} style={{ fontSize: 12, color: theme.gray, marginBottom: 2 }}>
              {a.employees?.name || "Unknown"}: {formatMoney(a.advance_amount_deducted)} / {formatMoney(a.amount)} EGP repaid
              {a.advance_deduction_type === "partial" && ` (${formatMoney(a.advance_installment_amount)} EGP/month)`}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setCategoryFilter("")}
          style={{ padding: "6px 14px", borderRadius: 999, border: `1px solid ${categoryFilter === "" ? theme.gold : "#ddd"}`, background: categoryFilter === "" ? theme.goldLight : "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategoryFilter(c.key)}
            style={{ padding: "6px 14px", borderRadius: 999, border: `1px solid ${categoryFilter === c.key ? theme.gold : "#ddd"}`, background: categoryFilter === c.key ? theme.goldLight : "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            {c.label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: theme.gray, marginLeft: "auto", fontWeight: 700 }}>Total: {formatMoney(totalShown)} EGP</span>
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, textAlign: "center", color: theme.gray }}>No expenses logged yet.</div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map((e) => (
          <div key={e.id} style={{ background: "#fff", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" }}>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 700, color: theme.navy, fontSize: 13 }}>{CATEGORY_LABEL[e.category] || e.category}</div>
              <div style={{ fontSize: 11, color: theme.gray }}>{e.entry_date}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: theme.navy }}>{e.note || "\u2014"}</div>
              {e.employees?.name && <div style={{ fontSize: 11, color: theme.gray }}>{e.employees.name}{e.branches?.name ? ` \u00b7 ${e.branches.name}` : ""}</div>}
              {e.category === "employee_advance" && (
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 999, fontWeight: 700, background: e.advance_status === "paid_off" ? "#e8f5e9" : "#fff8e1", color: e.advance_status === "paid_off" ? "#2e7d32" : "#a97c00" }}>
                    {e.advance_status === "paid_off" ? "Paid off" : `${e.advance_deduction_type === "full" ? "Full deduction" : "Partial " + formatMoney(e.advance_installment_amount) + "/mo"} \u00b7 ${formatMoney(e.advance_amount_deducted)}/${formatMoney(e.amount)} repaid`}
                  </span>
                </div>
              )}
            </div>
            <div style={{ fontWeight: 700, color: theme.navy, fontSize: 15 }}>{formatMoney(e.amount)} EGP</div>
          </div>
        ))}
      </div>

      {showForm && (
        <ExpenseForm
          employees={employees}
          branches={branches}
          profile={profile}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function ExpenseForm({ employees, branches, profile, onClose, onSaved }) {
  const [category, setCategory] = useState("utilities");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [deductionType, setDeductionType] = useState("full");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isAdvance = category === "employee_advance";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (isAdvance && !employeeId) {
      setError("Employee Advance requires an employee");
      return;
    }
    if (isAdvance && deductionType === "partial" && (!installmentAmount || Number(installmentAmount) <= 0)) {
      setError("Enter a monthly installment amount for partial deduction");
      return;
    }

    setSaving(true);
    const payload = {
      category,
      amount: Number(amount),
      entry_date: entryDate,
      note: note || null,
      employee_id: employeeId || null,
      branch_id: branchId || null,
      created_by_id: profile?.id || null,
      created_by_name: profile?.name || null,
    };
    if (isAdvance) {
      payload.advance_deduction_type = deductionType;
      payload.advance_installment_amount = deductionType === "partial" ? Number(installmentAmount) : null;
    }

    const { data, error: insertError } = await supabase.from("cash_expenses").insert(payload).select("id").single();
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: profile?.role === "admin" ? "admin" : "employee",
      action: "logged_cash_expense",
      entityType: "cash_expense",
      entityId: data.id,
      details: { category, amount: Number(amount), employeeId: employeeId || null },
    });
    onSaved();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 420, maxWidth: "90vw", maxHeight: "88vh", overflowY: "auto" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Log Cash Expense</h3>

        <FieldLabel>Category</FieldLabel>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        <FieldLabel>Amount (EGP)</FieldLabel>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />

        <FieldLabel>Date</FieldLabel>
        <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} style={inp} />

        <FieldLabel>Note</FieldLabel>
        <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} placeholder="Optional detail" />

        <FieldLabel>Branch (optional)</FieldLabel>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={inp}>
          <option value="">\u2014</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        <FieldLabel>{isAdvance ? "Employee (required)" : "Employee (optional)"}</FieldLabel>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={inp}>
          <option value="">\u2014</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>

        {isAdvance && (
          <div style={{ background: "#faf9fb", borderRadius: 8, padding: 12, marginTop: 8 }}>
            <FieldLabel>Deduct from payroll</FieldLabel>
            <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
              <label style={{ fontSize: 13, color: theme.navy, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={deductionType === "full"} onChange={() => setDeductionType("full")} /> Full amount, next payroll
              </label>
              <label style={{ fontSize: 13, color: theme.navy, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={deductionType === "partial"} onChange={() => setDeductionType("partial")} /> Partial, monthly installment
              </label>
            </div>
            {deductionType === "partial" && (
              <>
                <FieldLabel>Monthly installment (EGP)</FieldLabel>
                <input type="number" step="0.01" value={installmentAmount} onChange={(e) => setInstallmentAmount(e.target.value)} style={inp} placeholder="e.g. 300" />
              </>
            )}
          </div>
        )}

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldLabel({ children }) {
  return <label style={{ display: "block", fontSize: 11, color: theme.gray, fontWeight: 600, marginTop: 10, marginBottom: 4 }}>{children}</label>;
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
