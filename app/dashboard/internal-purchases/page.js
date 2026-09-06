"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { formatMoney } from "../../../lib/format";

const BRANDS = [
  { key: "scan", label: "Scan Center" },
  { key: "dental_stock", label: "Dental Supply" },
  { key: "el3awama_stock", label: "El3awama F&B" },
];
const LABEL = Object.fromEntries(BRANDS.map((b) => [b.key, b.label]));

// Section 4: one business buying from another. Distinct from Brand Transfer,
// which is a loan of capital and already existed.
export default function InternalPurchasesPage() {
  const { isAdmin, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState([]);
  const [netting, setNetting] = useState([]);
  const [elimination, setElimination] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ buyer: "scan", seller: "el3awama_stock", amount: "", cost: "", method: "cash", employeeId: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin]);

  async function load() {
    const [{ data: p }, { data: n }, { data: el }, { data: emp }] = await Promise.all([
      supabase.from("internal_purchases").select("*").order("entry_date", { ascending: false }).limit(30),
      supabase.from("internal_netting").select("*"),
      supabase.from("internal_profit_elimination").select("*"),
      supabase.from("employees").select("id, name").eq("is_active", true).order("name"),
    ]);
    setRows(p || []); setNetting(n || []); setElimination(el || []); setEmployees(emp || []);
  }

  async function save() {
    setError(""); setOk("");
    if (form.buyer === form.seller) return setError("A business cannot buy from itself.");
    if (!Number(form.amount)) return setError("Enter the amount.");
    if (form.method === "cash" && !form.employeeId) return setError("Choose who is handling the cash.");

    setSaving(true);
    const { data, error: err } = await supabase.rpc("record_internal_purchase", {
      p_buyer_brand: form.buyer,
      p_seller_brand: form.seller,
      p_amount: Number(form.amount),
      p_payment_method: form.method,
      p_employee_id: form.method === "cash" ? form.employeeId : null,
      p_cost_amount: form.cost ? Number(form.cost) : null,
      p_note: form.note || null,
      p_staff_id: null,
      p_staff_name: null,
    });
    setSaving(false);
    if (err) return setError(err.message);
    setOk(`Recorded ${formatMoney(data.amount)} EGP.`);
    setForm({ ...form, amount: "", cost: "", note: "" });
    load();
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!isAdmin) return <p style={{ color: theme.gray }}>Admin access required.</p>;

  const toEliminate = elimination.reduce((s, e) => s + Number(e.profit_to_eliminate), 0);

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Cash Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Internal Purchases</h1>
      <p style={{ color: theme.gray, margin: "0 0 20px" }}>
        One business buying goods or services from another, at sale price.
        For lending money between businesses, use Brand Transfer instead.
      </p>

      <div style={{ background: "#fff", borderRadius: 16, padding: 22, marginBottom: 18, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Record a Purchase</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <Field label="Buying business">
            <select value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} style={inp}>
              {BRANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </Field>
          <Field label="Selling business">
            <select value={form.seller} onChange={(e) => setForm({ ...form, seller: e.target.value })} style={inp}>
              {BRANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </Field>
          <Field label="Amount (sale price)">
            <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inp} />
          </Field>
          <Field label="Cost to seller (optional)">
            <input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} style={inp} />
          </Field>
          <Field label="Payment">
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} style={inp}>
              <option value="cash">Cash</option>
              <option value="postponed">Postponed</option>
            </select>
          </Field>
          {form.method === "cash" && (
            <Field label="Cash handled by">
              <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} style={inp}>
                <option value="">Select...</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        {form.method === "cash" && (
          <p style={{ fontSize: 11, color: theme.gray, margin: "8px 0 0" }}>
            The same person keeps the same physical notes. Only which business the money belongs to changes.
          </p>
        )}
        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
        {ok && <p style={{ color: "#1e7a3c", fontSize: 13 }}>{ok}</p>}
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, marginTop: 12 }}>
          {saving ? "Recording..." : "Record Purchase"}
        </button>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 22, marginBottom: 18, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Month-End Netting</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: -6 }}>
          Prepared for you to approve. Nothing posts automatically.
        </p>
        {netting.length === 0 ? <p style={{ color: theme.gray, fontSize: 13 }}>Nothing outstanding between businesses.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {netting.map((n, i) => (
              <div key={i} style={{ padding: 12, borderRadius: 8, background: "#fafbfc", border: "1px solid #eceff1", fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: theme.navy }}>{LABEL[n.brand_a]} &harr; {LABEL[n.brand_b]}</div>
                <div style={{ color: theme.gray, marginTop: 3 }}>
                  {LABEL[n.brand_a]} owes {formatMoney(n.a_owes_b)} · {LABEL[n.brand_b]} owes {formatMoney(n.b_owes_a)} ·
                  offset {formatMoney(n.net_offset)}
                </div>
                <div style={{ marginTop: 4, fontWeight: 700, color: theme.navy }}>
                  {Number(n.settlement) === 0 ? "Settled — nothing to pay" :
                   Number(n.settlement) > 0
                     ? `${LABEL[n.brand_a]} pays ${formatMoney(n.settlement)} EGP`
                     : `${LABEL[n.brand_b]} pays ${formatMoney(-n.settlement)} EGP`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toEliminate > 0 && (
        <div style={{ background: "#fffaf0", border: "1px solid #eddcb4", borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, color: "#8a6d00" }}>
            {formatMoney(toEliminate)} EGP of internal profit to remove from group revenue
          </div>
          <div style={{ fontSize: 12, color: "#7a6420", marginTop: 4 }}>
            Because businesses sell to each other at sale price, this profit is real for each
            business on its own but not for the group. It is removed before consolidated figures.
          </div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Recent Purchases</h3>
        {rows.length === 0 ? <p style={{ color: theme.gray, fontSize: 13 }}>Nothing recorded yet.</p> : (
          <div style={{ display: "grid", gap: 6 }}>
            {rows.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "9px 11px", borderRadius: 8, background: "#fafbfc", border: "1px solid #eceff1", fontSize: 13 }}>
                <span style={{ color: theme.gray }}>
                  {r.entry_date} · <strong style={{ color: theme.navy }}>{LABEL[r.buyer_brand]}</strong> bought from{" "}
                  <strong style={{ color: theme.navy }}>{LABEL[r.seller_brand]}</strong> · {r.payment_method}
                </span>
                <strong style={{ color: theme.navy }}>{formatMoney(r.amount)} EGP</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.gray, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
const inp = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #d8dee3", fontSize: 13, boxSizing: "border-box" };
const primaryBtn = { padding: "11px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 };
