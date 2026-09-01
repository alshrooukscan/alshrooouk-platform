"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { usePermissions } from "../lib/usePermissions";
import { formatMoney } from "../lib/format";
import { logActivity } from "../lib/activityLog";

const PAYMENT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "visa", label: "Visa" },
  { key: "instapay", label: "InstaPay" },
  { key: "wallet", label: "Wallet" },
];
// Employee Advance is deliberately NOT offered here - that category only
// triggers payroll deduction when logged through the existing Center
// Expenses page (generate_payslip() reads cash_expenses specifically, not
// expense_transactions). Offering it here would silently create an advance
// that's never actually deducted from pay - a real money-loss risk, not a
// cosmetic gap.
const CASH_OUT_CATEGORIES = [
  { key: "utilities", label: "Utilities" },
  { key: "maintenance", label: "Maintenance" },
  { key: "supplies", label: "Supplies / Misc Purchase" },
  { key: "courier", label: "Courier / Rep Cash" },
  { key: "other", label: "Other" },
];

// Shared page for all three brands (Scan, Dental Stock, El3awama Stock) -
// each one's own page is a thin wrapper passing in brand/brandLabel/
// permissionKey. Shows who's holding cash for this brand right now, and lets
// staff with access log a Cash Transfer (to another employee, always cash,
// confirmed by the receiving employee from their own portal) or a Cash
// Collection (to the owner, cash or electronic, always confirmed by admin).
export default function BrandCashPage({ brand, brandLabel, permissionKey }) {
  const { can, loading: permsLoading, profile } = usePermissions();
  const [balances, setBalances] = useState([]);
  const [recent, setRecent] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // "transfer" | "collection" | "cash_out" | null

  const hasAccess = permsLoading || can(permissionKey);

  useEffect(() => {
    if (hasAccess) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess]);

  async function load() {
    setLoading(true);
    const [{ data: bal }, { data: emps }, { data: tx }] = await Promise.all([
      supabase.from("employee_cash_balances").select("*, employees(name)").eq("brand", brand),
      supabase.from("employees").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("expense_transactions")
        .select("*, from_employee:from_employee_id(name), to_employee:to_employee_id(name)")
        .eq("brand", brand)
        .in("type", ["cash_transfer", "cash_collection", "cash_out"])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setBalances((bal || []).filter((b) => Number(b.balance) !== 0));
    setEmployees(emps || []);
    setRecent(tx || []);
    setLoading(false);
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!hasAccess) return <p style={{ color: theme.gray }}>You don't have access to this page.</p>;

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Expenses Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>{brandLabel} Cash</h1>
      <p style={{ color: theme.gray, margin: "0 0 20px" }}>Who's holding cash for {brandLabel} right now, and logging transfers or settlements.</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={() => setModal("cash_out")} style={primaryBtn}>+ Log Cash Out</button>
        <button onClick={() => setModal("transfer")} style={secondaryBtn}>+ Log Cash Transfer</button>
        <button onClick={() => setModal("collection")} style={secondaryBtn}>+ Log Cash Collection</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Cash In Hand</h3>
        {!loading && balances.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No one is currently holding {brandLabel} cash.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {balances.map((b) => (
            <div key={b.employee_id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{b.employees?.name}</span>
              <span style={{ fontWeight: 700, color: theme.gold }}>{formatMoney(b.balance)} EGP</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Recent Transfers &amp; Collections</h3>
        {!loading && recent.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing logged yet.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {recent.map((tx) => (
            <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: tx.status === "confirmed" ? "#e8f5e9" : tx.status === "rejected" ? "#fdecea" : "#fff8e1", color: tx.status === "confirmed" ? "#2e7d32" : tx.status === "rejected" ? "#ba1a1a" : "#a97c00", minWidth: 76, textAlign: "center", textTransform: "capitalize" }}>
                {tx.status}
              </span>
              <div style={{ flex: 1, fontSize: 13 }}>
                <strong style={{ color: theme.navy }}>
                  {tx.type === "cash_transfer" ? "Transfer" : tx.type === "cash_collection" ? "Collection" : "Cash Out"}
                </strong>{" "}
                {formatMoney(tx.amount)} EGP
                {tx.category && ` \u00b7 ${tx.category}`}
                {tx.from_employee?.name && ` from ${tx.from_employee.name}`}
                {tx.to_employee?.name && ` to ${tx.to_employee.name}`}
                {tx.type === "cash_collection" && !tx.to_employee?.name && " to Owner"}
                <span style={{ color: theme.gray }}> · {tx.entry_date}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal === "cash_out" && (
        <CashOutModal brand={brand} profile={profile} onClose={() => setModal(null)} onSaved={load} />
      )}
      {modal === "transfer" && (
        <TransferModal brand={brand} employees={employees} profile={profile} onClose={() => setModal(null)} onSaved={load} />
      )}
      {modal === "collection" && (
        <CollectionModal brand={brand} employees={employees} profile={profile} onClose={() => setModal(null)} onSaved={load} />
      )}
    </div>
  );
}

function CashOutModal({ brand, profile, onClose, onSaved }) {
  const [category, setCategory] = useState("utilities");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    // Cash is physically reconciled and confirmed immediately; anything else
    // waits in the Confirmation Queue.
    const status = paymentMethod === "cash" ? "confirmed" : "pending";
    const { data, error: err } = await supabase
      .from("expense_transactions")
      .insert({
        type: "cash_out",
        brand,
        amount: Number(amount),
        payment_method: paymentMethod,
        category,
        note: note || null,
        status,
        confirmed_by_id: status === "confirmed" ? profile?.id || null : null,
        confirmed_by_name: status === "confirmed" ? profile?.name || null : null,
        confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
        created_by_id: profile?.id || null,
        created_by_name: profile?.name || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: "logged_cash_out",
      entityType: "expense_transaction",
      entityId: data.id,
      details: { brand, category, paymentMethod, amount: Number(amount) },
    });
    onSaved();
    onClose();
  }

  return (
    <Modal title="Log Cash Out" onClose={onClose}>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>
        For an employee advance, use Center Expenses instead - only that page's advances get deducted from payroll.
      </p>
      <FieldLabel>Category</FieldLabel>
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
        {CASH_OUT_CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>{c.label}</option>
        ))}
      </select>
      <FieldLabel>Paid Via</FieldLabel>
      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={inp}>
        {PAYMENT_METHODS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>
      <FieldLabel>Amount (EGP)</FieldLabel>
      <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />
      <FieldLabel>Note (optional)</FieldLabel>
      <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} />
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Log Cash Out"}</button>
      </div>
    </Modal>
  );
}

function TransferModal({ brand, employees, profile, onClose, onSaved }) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!fromId || !toId || fromId === toId) {
      setError("Select two different employees.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    const { data, error: err } = await supabase
      .from("expense_transactions")
      .insert({
        type: "cash_transfer",
        brand,
        amount: Number(amount),
        payment_method: "cash",
        from_employee_id: fromId,
        to_employee_id: toId,
        note: note || null,
        status: "pending",
        created_by_id: profile?.id || null,
        created_by_name: profile?.name || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: "logged_cash_transfer",
      entityType: "expense_transaction",
      entityId: data.id,
      details: { brand, amount: Number(amount) },
    });
    onSaved();
    onClose();
  }

  return (
    <Modal title="Log Cash Transfer" onClose={onClose}>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>Always cash - confirmed by the employee receiving it, from their own portal.</p>
      <FieldLabel>Handing Over</FieldLabel>
      <select value={fromId} onChange={(e) => setFromId(e.target.value)} style={inp}>
        <option value="">Select employee...</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <FieldLabel>Receiving</FieldLabel>
      <select value={toId} onChange={(e) => setToId(e.target.value)} style={inp}>
        <option value="">Select employee...</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <FieldLabel>Amount (EGP)</FieldLabel>
      <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />
      <FieldLabel>Note (optional)</FieldLabel>
      <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} />
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Log Transfer"}</button>
      </div>
    </Modal>
  );
}

function CollectionModal({ brand, employees, profile, onClose, onSaved }) {
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!employeeId) {
      setError("Select the employee settling cash.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    const { data, error: err } = await supabase
      .from("expense_transactions")
      .insert({
        type: "cash_collection",
        brand,
        amount: Number(amount),
        payment_method: paymentMethod,
        from_employee_id: employeeId,
        note: note || null,
        status: "pending",
        created_by_id: profile?.id || null,
        created_by_name: profile?.name || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    logActivity({
      actorId: profile?.id,
      actorName: profile?.name,
      actorType: "admin",
      action: "logged_cash_collection",
      entityType: "expense_transaction",
      entityId: data.id,
      details: { brand, amount: Number(amount), paymentMethod },
    });
    onSaved();
    onClose();
  }

  return (
    <Modal title="Log Cash Collection" onClose={onClose}>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: -8 }}>Settling to the Owner - cash or electronic, always waits for Owner's confirmation.</p>
      <FieldLabel>Employee Settling</FieldLabel>
      <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={inp}>
        <option value="">Select employee...</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <FieldLabel>Amount (EGP)</FieldLabel>
      <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />
      <FieldLabel>Paid Via</FieldLabel>
      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={inp}>
        {PAYMENT_METHODS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>
      <FieldLabel>Note (optional)</FieldLabel>
      <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} />
      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={primaryBtn}>{saving ? "Saving..." : "Log Collection"}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 400, maxWidth: "90vw" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
function FieldLabel({ children }) {
  return <label style={{ display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginTop: 12, marginBottom: 4 }}>{children}</label>;
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
const primaryBtn = { padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, flex: 1 };
const secondaryBtn = { padding: "10px 20px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 13 };
const cancelBtn = { flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, cursor: "pointer" };
