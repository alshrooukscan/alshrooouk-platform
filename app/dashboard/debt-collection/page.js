"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { formatMoney, formatVisitDateTime } from "../../../lib/format";

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
  const [patientDebts, setPatientDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [brandFilter, setBrandFilter] = useState("all");
  const [staffList, setStaffList] = useState([]);
  const [selfEmployeeId, setSelfEmployeeId] = useState(null);

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
      setPatientDebts(json.patientDebts || []);
      setStaffList(json.staff || []);
      setSelfEmployeeId(json.selfEmployeeId || null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!hasAccess) return <p style={{ color: theme.gray }}>You don&apos;t have access to this page.</p>;

  const shown = brandFilter === "all" ? customers : customers.filter((c) => c.brand === brandFilter);

  // The patient debts I added yesterday were listed but never counted, so the
  // Scan Center tab read 0 EGP above a list of nine patients owing 8,590. A
  // total that contradicts the rows beneath it is worse than no total: it
  // teaches people not to trust either.
  const scanShown = brandFilter === "all" || brandFilter === "scan" ? patientDebts : [];
  const scanTotal = scanShown.reduce((s, v) => s + v.balance, 0);

  const total = shown.reduce((s, c) => s + c.balance, 0) + scanTotal;

  // A patient owing on two visits is one customer, not two.
  const customersOwing = shown.length + new Set(scanShown.map((v) => v.patient_id)).size;

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
        <StatCard label="Customers Owing" value={customersOwing} tone={theme.navy} />
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
            {/* "Nobody is carrying a balance" sat directly above nine patients
                who were. Scoped to what this card is actually about. */}
            No clinic or account balance for this business. Postponed orders will appear here once they are recorded.
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
                      {c.doctors?.length > 0 && ` · ${c.doctors.slice(0, 3).join(", ")}`}
                      {c.credit_limit_enabled && ` · limit ${formatMoney(c.credit_limit)} EGP`}
                      {over && <strong style={{ color: "#ba1a1a" }}> · over limit</strong>}
                    </div>
                    {/* What the balance is made of. A clinic owing 9,920 EGP is
                        not something reception can discuss on the phone without
                        knowing which orders it came from. */}
                    {c.charges?.length > 0 && (
                      <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>
                        {c.charges.slice(0, 4).map((ch, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            {ch.reference || ch.note || ch.reference_type || "charge"} {formatMoney(ch.amount)}
                          </span>
                        ))}
                        {c.charges.length > 4 && ` · +${c.charges.length - 4} more`}
                      </div>
                    )}
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

      {/* Patients who owe the centre for a scan. None of this appeared on the
          page before - 13,920 EGP across two dozen visits was uncollectable
          because nobody could see it. It is not in the AR ledger: a visit
          carries its own charge and what has been paid against it, so the debt
          is the difference, and it belongs to a visit rather than an account.
          Shown with the scan and the date, and the name opens the patient. */}
      {(brandFilter === "all" || brandFilter === "scan") && patientDebts.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginTop: 20 }}>
          <h3 style={{ color: theme.navy, margin: "0 0 2px", fontSize: 16 }}>Patients owing for a scan</h3>
          <p style={{ color: theme.gray, fontSize: 12, margin: "0 0 14px" }}>
            {patientDebts.length} visit{patientDebts.length === 1 ? "" : "s"} not fully paid, {" "}
            {formatMoney(patientDebts.reduce((t, v) => t + v.balance, 0))} EGP outstanding. Payment is recorded on the visit itself.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {patientDebts.map((v) => (
              <div
                key={v.visit_id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 10, border: "1px solid #eceff1", background: "#fafbfc",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <a
                    href={`/dashboard/patients/${v.patient_id}?visit=${v.visit_id}`}
                    style={{ fontWeight: 700, color: theme.navy, textDecoration: "none" }}
                  >
                    {v.name}
                  </a>
                  <div style={{ fontSize: 12, color: theme.gray }}>
                    {(v.scan_types || []).join(", ") || "scan"}
                    {v.exam_date ? ` · ${formatVisitDateTime(v.exam_date, v.exam_time)}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: theme.gray }}>
                    charged {formatMoney(v.amount_due)} · paid {formatMoney(v.amount_paid)}
                    {v.discount_pct > 0 && (
                      <span style={{ color: "#8a6d00", fontWeight: 700 }}>
                        {" · "}after {v.discount_pct}% discount
                        {v.discount_reason ? ` (${v.discount_reason})` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ fontWeight: 800, color: theme.navy, whiteSpace: "nowrap" }}>
                    {formatMoney(v.balance)} EGP
                  </div>
                  <a
                    href={`/dashboard/patients/${v.patient_id}?visit=${v.visit_id}`}
                    style={{ ...primaryBtn, textDecoration: "none", display: "inline-block" }}
                  >
                    Open visit
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {target && (
        <PaymentModal
          staffList={staffList}
          selfEmployeeId={selfEmployeeId}
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

function PaymentModal({ customer, staffList, selfEmployeeId, authedFetch, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  // Cash has to be attributed to whoever is physically holding it. Taken from
  // the login when it maps to an employee; asked for when it does not, instead
  // of failing the collection after the fact.
  // Always the signed-in employee. Kept as state only because the submit path
  // reads it; nothing sets it to anybody else.
  const collectedBy = selfEmployeeId || "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const amt = Number(amount);
  const remaining = customer.balance - (amt > 0 ? amt : 0);

  async function save() {
    setError("");
    if (!amt || amt <= 0) return setError("Enter the amount collected.");
    if (amt > customer.balance) return setError(`That is more than the ${formatMoney(customer.balance)} EGP outstanding.`);
    if (paymentMethod === "cash" && !acknowledged) return setError("Please confirm the cash has been received.");
    if (paymentMethod === "cash" && !collectedBy)
      return setError("Your login isn't linked to an employee record, so cash can't be recorded against you. Ask an admin to link it, or record this as a card or transfer payment.");

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
          collectedByEmployeeId: paymentMethod === "cash" ? collectedBy : null,
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

      {/* The cash goes to whoever is signed in. It was a dropdown of every
          employee, which let one person's collection be recorded against
          another - the same thing that was closed on the counter sale screen.
          Nobody should be able to put money in a colleague's hands by choosing
          their name from a list. */}
      {paymentMethod === "cash" && (
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy, display: "block", marginBottom: 6 }}>
            Who is taking the cash
          </label>
          {selfEmployeeId ? (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#faf9fb", border: "1px solid #eee", fontSize: 14, color: theme.navy, fontWeight: 600 }}>
              {staffList.find((e) => e.id === selfEmployeeId)?.name || "You"}
              <span style={{ color: theme.gray, fontWeight: 400, fontSize: 12 }}> · it goes into your cash in hand</span>
            </div>
          ) : (
            // Not a dropdown by choice: a login with no employee record cannot
            // take cash at all, and picking somebody else would only move the
            // problem onto them.
            <p style={{ fontSize: 12, color: "#ba1a1a", margin: 0 }}>
              Your login isn&apos;t linked to an employee record, so cash can&apos;t be attributed to you.
              Ask an admin to link it, or record this as a card or transfer payment.
            </p>
          )}
        </div>
      )}

      {paymentMethod === "cash" && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13, color: theme.navy }}>
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            I confirm this cash has been received. It will be added to that person&apos;s cash in hand until they hand it over.
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
