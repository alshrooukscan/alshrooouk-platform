"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { formatMoney } from "../../../lib/format";

const BRANDS = [
  { key: "el3awama_stock", label: "El3awama F&B" },
  { key: "dental_stock", label: "Dental Supply" },
];
const METHODS = [
  { key: "cash", label: "Cash" },
  { key: "visa", label: "Visa" },
  { key: "instapay", label: "InstaPay" },
  { key: "wallet", label: "Wallet" },
  { key: "postponed", label: "Postponed (on account)" },
  { key: "staff_tab", label: "Staff Tab" },
];

// The counter / till screen. El3awama had no way to sell anything at all
// before this, which is why its revenue always read zero.
export default function CounterSalePage() {
  const { can, isAdmin, loading: permsLoading } = usePermissions();
  const [brand, setBrand] = useState("el3awama_stock");
  const [items, setItems] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [cart, setCart] = useState({});
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("cash");
  const [employeeId, setEmployeeId] = useState("");
  const [tabPin, setTabPin] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const hasAccess = permsLoading || isAdmin || can("stock") || can("reception");

  useEffect(() => { if (hasAccess) load(); /* eslint-disable-next-line */ }, [hasAccess, brand]);

  async function authed(url, opts = {}) {
    const { data } = await supabase.auth.getSession();
    return fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token}` },
    });
  }

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await authed(`/api/counter-sales?brand=${brand}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not load the counter.");
      setItems(j.items || []); setStaffList(j.staff || []); setDoctors(j.doctors || []);
      setCart({});
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  const lines = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => {
      const it = items.find((i) => i.id === id);
      return it ? { ...it, qty: q, line: q * Number(it.sale_price) } : null;
    })
    .filter(Boolean);
  const gross = lines.reduce((s, l) => s + l.line, 0);

  const chosen = staffList.find((s) => s.id === employeeId);
  const discount = method === "staff_tab" && chosen ? chosen.discount_percent : 0;
  const net = gross * (1 - discount / 100);
  const overCap = method === "staff_tab" && chosen && net > chosen.remaining;

  function setQty(id, q) {
    const it = items.find((i) => i.id === id);
    const max = Number(it?.qty_remaining || 0);
    setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(q, max)) }));
  }

  async function submit() {
    setError("");
    if (lines.length === 0) return setError("Add something to the sale first.");
    if (method === "staff_tab") {
      if (!employeeId) return setError("Choose which employee this goes on.");
      if (!chosen?.has_pin) return setError("That employee has no tab PIN set yet. An admin sets it in Settings.");
      if (tabPin.length !== 4) return setError("Enter the employee's 4-digit PIN.");
    }
    if (method === "postponed" && !customerId) return setError("Choose the customer this is billed to.");

    setSaving(true);
    try {
      const res = await authed("/api/counter-sales", {
        method: "POST",
        body: JSON.stringify({
          brand,
          items: lines.map((l) => ({ stock_item_id: l.id, quantity: l.qty })),
          paymentMethod: method,
          customerType: method === "postponed" ? "doctor" : null,
          customerId: method === "postponed" ? customerId : null,
          employeeId: method === "staff_tab" ? employeeId : null,
          tabPin: method === "staff_tab" ? tabPin : null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not record that sale.");
      setDone(j.result);
      setTabPin(""); setCustomerId(""); setEmployeeId("");
      load();
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!hasAccess) return <p style={{ color: theme.gray }}>You don&apos;t have access to this page.</p>;

  const shown = items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Cash Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Counter Sale</h1>
      <p style={{ color: theme.gray, margin: "0 0 18px" }}>Walk-up sales for El3awama and Dental Supply.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {BRANDS.map((b) => (
          <button key={b.key} onClick={() => setBrand(b.key)}
            style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              border: brand === b.key ? "none" : "1px solid #d8dee3",
              background: brand === b.key ? theme.navy : "#fff",
              color: brand === b.key ? "#fff" : theme.gray }}>
            {b.label}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        {/* items */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items..."
            style={{ ...inp, marginBottom: 12 }} />
          {loading ? <p style={{ color: theme.gray }}>Loading...</p>
            : shown.length === 0 ? <p style={{ color: theme.gray }}>Nothing in stock for this business.</p>
            : (
            <div style={{ display: "grid", gap: 6, maxHeight: 460, overflowY: "auto" }}>
              {shown.map((i) => (
                <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  gap: 10, padding: "9px 11px", borderRadius: 8, border: "1px solid #eceff1", background: cart[i.id] ? "#f2f8f4" : "#fafbfc" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: theme.navy, fontSize: 13 }}>{i.name}</div>
                    <div style={{ fontSize: 11, color: theme.gray }}>
                      {formatMoney(i.sale_price)} EGP · {Number(i.qty_remaining)} left
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => setQty(i.id, (cart[i.id] || 0) - 1)} style={qtyBtn}>-</button>
                    <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700, color: theme.navy }}>{cart[i.id] || 0}</span>
                    <button onClick={() => setQty(i.id, (cart[i.id] || 0) + 1)} style={qtyBtn}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* checkout */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>This Sale</h3>
          {lines.length === 0 ? <p style={{ color: theme.gray, fontSize: 13 }}>Nothing added yet.</p> : (
            <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
              {lines.map((l) => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: theme.gray }}>{l.qty} x {l.name}</span>
                  <span style={{ color: theme.navy, fontWeight: 600 }}>{formatMoney(l.line)}</span>
                </div>
              ))}
            </div>
          )}

          <FieldLabel>Payment</FieldLabel>
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={inp}>
            {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>

          {method === "postponed" && (
            <>
              <FieldLabel>Billed To</FieldLabel>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={inp}>
                <option value="">Select customer...</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.clinic_name ? ` (${d.clinic_name})` : ""}</option>)}
              </select>
              <p style={{ fontSize: 11, color: theme.gray, margin: "4px 0 0" }}>
                This is added to what they owe, and appears in Debt Collection.
              </p>
            </>
          )}

          {method === "staff_tab" && (
            <>
              <FieldLabel>Employee</FieldLabel>
              <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setTabPin(""); }} style={inp}>
                <option value="">Select employee...</option>
                {staffList.filter((s) => s.tab_enabled).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {formatMoney(s.remaining)} EGP left</option>
                ))}
              </select>
              {chosen && (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 8,
                  background: overCap ? "#fff5f5" : "#f2f8f4", border: `1px solid ${overCap ? "#f0c9c9" : "#cfe6d6"}` }}>
                  <div style={{ fontSize: 12, color: overCap ? "#ba1a1a" : "#1e7a3c", fontWeight: 700 }}>
                    {overCap
                      ? `Over limit — they can spend ${formatMoney(chosen.remaining)} EGP right now.`
                      : `Within limit — ${formatMoney(chosen.remaining)} EGP available.`}
                  </div>
                  <div style={{ fontSize: 11, color: theme.gray, marginTop: 2 }}>
                    The limit is half of what they have earned so far this month, and grows as they work.
                  </div>
                </div>
              )}
              {chosen && !chosen.has_pin && (
                <p style={{ fontSize: 12, color: "#ba1a1a", margin: "6px 0 0" }}>
                  No PIN set for this employee yet. An admin sets it before they can use a tab.
                </p>
              )}
              {chosen?.has_pin && (
                <>
                  <FieldLabel>Their 4-digit PIN</FieldLabel>
                  <input value={tabPin} onChange={(e) => setTabPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric" placeholder="----" type="password"
                    style={{ ...inp, letterSpacing: 6, textAlign: "center", fontSize: 16 }} />
                </>
              )}
            </>
          )}

          <div style={{ borderTop: "1px solid #eceff1", marginTop: 14, paddingTop: 12 }}>
            {discount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: theme.gray }}>
                <span>Staff discount {discount}%</span>
                <span>-{formatMoney(gross - net)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ color: theme.gray, fontSize: 13 }}>Total</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: theme.navy }}>{formatMoney(net)} EGP</span>
            </div>
          </div>

          <button onClick={submit} disabled={saving || lines.length === 0 || overCap}
            style={{ ...primaryBtn, width: "100%", marginTop: 12, opacity: saving || lines.length === 0 || overCap ? 0.5 : 1 }}>
            {saving ? "Recording..." : "Complete Sale"}
          </button>
        </div>
      </div>

      {done && (
        <Modal title="Sale Recorded" onClose={() => setDone(null)}>
          <div style={{ background: "#f4f7f8", borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <Row k="Receipt No." v={done.receipt_no} strong />
            <Row k="Total" v={`${formatMoney(done.net)} EGP`} strong />
            <Row k="Method" v={done.method.replace("_", " ")} />
          </div>
          <button onClick={() => setDone(null)} style={primaryBtn}>Done</button>
        </Modal>
      )}
    </div>
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
function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 420 }}>
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
const qtyBtn = { width: 26, height: 26, borderRadius: 6, border: "1px solid #d8dee3", background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 14, lineHeight: 1 };
const primaryBtn = { padding: "11px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 };
