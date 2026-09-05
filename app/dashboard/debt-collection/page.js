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
const BRAND_LABEL = Object.fromEntries(BRANDS.map((b) => [b.key, b.label]));
const PAYMENT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "visa", label: "Visa" },
  { key: "instapay", label: "InstaPay" },
  { key: "wallet", label: "Wallet" },
];

// Debt collection (spec section 5). Shows every customer currently carrying a
// balance, and records payments against it. All writes go through /api/ar so
// the ledger row, the receipt number and the cash custody credit are written
// in one database transaction rather than three separate client calls.
export default function DebtCollectionPage() {
  const { can, isAdmin, loading: permsLoading } = usePermissions();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [brandFilter, setBrandFilter] = useState("all");

  const hasAccess = permsLoading || isAdmin || can("stock") || can("reception");

  useEffect(() => {
    if (hasAccess) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess]);

  async function authedFetch(url, opts = {}) {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await authedFetch("/api/ar");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load outstanding balances.");
      setCustomers(json.customers || []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!hasAccess) return <p style={{ color: theme.gray }}>You don&apos;t have access to this page.</p>;

  const shown = brandFilter === "all" ? customers : customers.filter((c) => c.brand === brandFilter);
  const total = shown.reduce((s, c) => s + c.balance, 0);
  const overLimit = shown.filter((c) => c.credit_limit_enabled && c.balance > c.credit_limit);

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Cash Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Debt Collection</h1>
      <p style={{ color: theme.gray, margin: "0 0 20px" }}>
        Customers carrying an unpaid balance, and recording what they pay.
      </p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Total Outstanding" value={`${formatMoney(total)} EGP`} tone={theme.navy} />
        <StatCard label="Customers Owing" value={shown.length} tone={theme.navy} />
        <StatCard label="Over Credit Limit" value={overLimit.length} tone={overLimit.length ? "#ba1a1a" : theme.navy} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <FilterBtn active={brandFilter === "all"} onClick={() => setBrandFilter("all")}>All Businesses</FilterBtn>
        {BRANDS.map((b) => (
          <FilterBtn key={b.key} active={brandFilter === b.key} onClick={() => setBrandFilter(b.key)}>
            {b.label}
          </FilterBtn>
        ))}
      </div>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        {loading ? (
          <p style={{ color: theme.gray, margin: 0 }}>Loading...</p>
        ) : shown.length === 0 ? (
          <p style={{ color: theme.gray, margin: 0 }}>
            Nobody is carrying a balance right now. Postponed orders will appear here once they are recorded.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {shown.map((c) => {
              const over = c.credit_limit_enabled && c.balance > c.credit_limit;
              return (
                <div
                  key={`${c.customer_id}-${c.brand}`}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                    padding: "12px 14px", borderRadius: 10, border: "1px solid #eceff1",
                    background: over ? "#fff5f5" : "#fafbfc",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: theme.navy }}>
                      {c.name}
                      {c.clinic_name ? <span style={{ color: theme.gray, fontWeight: 400 }}> · {c.clinic_name}</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: theme.gray }}>
                      {BRAND_LABEL[c.brand] || c.brand}
                      {c.credit_limit_enabled && ` · limit ${formatMoney(c.credit_limit)} EGP`}
                      {over && <strong style={{ color: "#ba1a1a" }}> · over limit</strong>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontWeight: 800, color: over ? "#ba1a1a" : theme.navy, whiteSpace: "nowrap" }}>
                      {formatMoney(c.balance)} EGP
                    </div>
                    <button onClick={() => setTarget(c)} style={primaryBtn}>Record Payment</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {target && (
        <PaymentModal
          customer={target}
          authedFetch={authedFetch}
          onClose={() => setTarget(null)}
          onSaved={(r) => { setTarget(null); setReceipt(r); load(); }}
        />
      )}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function PaymentModal({ customer, authedFetch, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const amt = Number(amount);
  const remaining = customer.balance - (amt > 0 ? amt : 0);

  async function save() {
    setError("");
    if (!amt || amt <= 0) return setError("Enter the amount collected.");
    if (amt > customer.balance) return setError(`That is more than the ${formatMoney(customer.balance)} EGP outstanding.`);
    if (paymentMethod === "cash" && !acknowledged) return setError("Please confirm the cash has been received.");

    setSaving(true);
    try {
      const res = await authedFetch("/api/ar", {
        method: "POST",
        body: JSON.stringify({
          action: "payment",
          customerType: customer.customer_type,
          customerId: customer.customer_id,
          brand: customer.brand,
          amount: amt,
          paymentMethod,
          cashAcknowledged: acknowledged,
          note: note || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not record that payment.");
      onSaved({ ...json.result, customerName: customer.name, brand: customer.brand });
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  return (
    <Modal title={`Record Payment · ${customer.name}`} onClose={onClose}>
      <p style={{ fontSize: 13, color: theme.gray, marginTop: -6 }}>
        Currently owes <strong style={{ color: theme.navy }}>{formatMoney(customer.balance)} EGP</strong> for{" "}
        {BRAND_LABEL[customer.brand] || customer.brand}.
      </p>

      <FieldLabel>Amount Collected (EGP)</FieldLabel>
      <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />
      {amt > 0 && amt <= customer.balance && (
        <p style={{ fontSize: 12, color: theme.gray, margin: "4px 0 0" }}>
          Remaining after this payment: <strong>{formatMoney(remaining)} EGP</strong>
        </p>
      )}

      <FieldLabel>Paid Via</FieldLabel>
      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={inp}>
        {PAYMENT_METHODS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>

      {paymentMethod === "cash" && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13, color: theme.navy }}>
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            I confirm I have received this cash. It will be added to my cash in hand until I hand it over.
          </span>
        </label>
      )}

      <FieldLabel>Note (optional)</FieldLabel>
      <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} />

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtn}>
          {saving ? "Recording..." : "Record Payment"}
        </button>
      </div>
    </Modal>
  );
}

function ReceiptModal({ receipt, onClose }) {
  return (
    <Modal title="Payment Recorded" onClose={onClose}>
      <div style={{ background: "#f4f7f8", borderRadius: 10, padding: 16, marginBottom: 12 }}>
        <Row k="Receipt No." v={receipt.receipt_no} strong />
        <Row k="Customer" v={receipt.customerName} />
        <Row k="Business" v={BRAND_LABEL[receipt.brand] || receipt.brand} />
        <Row k="Amount Paid" v={`${formatMoney(receipt.amount)} EGP`} strong />
        <Row k="Method" v={receipt.method} />
        <Row k="Remaining Balance" v={`${formatMoney(receipt.outstanding)} EGP`} strong />
      </div>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: 0 }}>
        Sending the printed and WhatsApp receipt to the customer is the next part of this stage.
      </p>
      <button onClick={onClose} style={primaryBtn}>Done</button>
    </Modal>
  );
}

function Row({ k, v, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
      <span style={{ color: theme.gray }}>{k}</span>
      <span style={{ color: theme.navy, fontWeight: strong ? 700 : 500 }}>{v}</span>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", minWidth: 170, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ fontSize: 12, color: theme.gray, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: tone }}>{value}</div>
    </div>
  );
}

function FilterBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 600,
        border: active ? "none" : "1px solid #d8dee3",
        background: active ? theme.navy : "#fff",
        color: active ? "#fff" : theme.gray,
      }}
    >
      {children}
    </button>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(20,24,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}
      >
        <h3 style={{ color: theme.navy, marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return <p style={{ fontSize: 12, color: theme.gray, margin: "12px 0 4px", fontWeight: 600 }}>{children}</p>;
}

const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #d8dee3", fontSize: 13, boxSizing: "border-box" };
const primaryBtn = { padding: "10px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 };
const cancelBtn = { padding: "10px 18px", borderRadius: 8, border: "1px solid #d8dee3", background: "#fff", color: theme.gray, fontWeight: 600, cursor: "pointer", fontSize: 13 };
