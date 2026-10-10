"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";

// Returns from customers. Staff find the sale, choose what came back and why;
// an admin approves it in the Action Center, and only then does the stock go
// back on the shelf and the money come off the clinic's account (or get
// refunded). See migration 0111.

const METHOD = { cash: "Cash", visa: "Visa", instapay: "InstaPay", wallet: "Wallet", postponed: "On account", staff_tab: "Staff tab" };
const STATUS_STYLE = {
  pending: { background: "#fff4e0", color: "#a06000", label: "Waiting for admin" },
  approved: { background: "#e8f5e9", color: "#2e7d32", label: "Approved" },
  rejected: { background: "#fdecea", color: "#ba1a1a", label: "Rejected" },
};
const MODE_LABEL = { account: "Off the clinic's account", credit: "Credit on the clinic's account", cash: "Cash refund", tab: "Off the staff tab" };

function formatDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "-";
}
const money = (n) => formatMoney(n, { decimals: 2 });
const qtyText = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function ReturnsPage() {
  const [receipt, setReceipt] = useState("");
  const [sale, setSale] = useState(null);
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("credit");
  const [refunder, setRefunder] = useState("");
  const [employees, setEmployees] = useState([]);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    loadHistory();
    supabase.from("employees").select("id, name").eq("is_active", true).order("name").then(({ data }) => setEmployees(data || []));
    // Opened from a statement or a recent sale: the sale comes in the link.
    const p = new URLSearchParams(window.location.search);
    if (p.get("receipt")) { setReceipt(p.get("receipt")); find({ receipt: p.get("receipt") }); }
    else if (p.get("source") && p.get("id")) find({ source: p.get("source"), id: p.get("id") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadHistory() {
    const { data } = await supabase
      .from("sale_returns")
      .select("*, sale_return_lines(item_name, qty, unit_price)")
      .order("requested_at", { ascending: false })
      .limit(50);
    setHistory(data || []);
  }

  async function find(arg) {
    setError(""); setDone(null); setSale(null); setQty({}); setReason("");
    const params = arg?.source
      ? { p_receipt: null, p_source_type: arg.source, p_source_id: arg.id }
      : { p_receipt: (arg?.receipt ?? receipt).trim(), p_source_type: null, p_source_id: null };
    if (!params.p_receipt && !params.p_source_id) return setError("Enter the receipt number, for example RCPM-2026-00115.");
    setBusy(true);
    const { data, error: err } = await supabase.rpc("get_returnable_sale", params);
    setBusy(false);
    if (err) return setError(err.message);
    setSale(data);
    setMode("credit");
  }

  const total = sale
    ? sale.lines.reduce((s, l) => s + (Number(qty[l.stock_item_id]) || 0) * Number(l.unit_price), 0) * (1 - Number(sale.discount_percent || 0) / 100)
    : 0;
  const paidSale = sale && !sale.on_account && !sale.staff_tab;

  async function submit() {
    setError("");
    const lines = sale.lines
      .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(qty[l.stock_item_id]) || 0 }))
      .filter((l) => l.qty > 0);
    if (!lines.length) return setError("Enter how many of at least one item came back.");
    for (const l of sale.lines) {
      const q = Number(qty[l.stock_item_id]) || 0;
      if (q > Number(l.returnable)) return setError(`Only ${qtyText(l.returnable)} of ${l.item_name} can still be returned.`);
    }
    if (!reason.trim()) return setError("Give the reason for the return.");
    if (paidSale && mode === "cash" && !refunder) return setError("Choose who is handing the cash back.");
    setBusy(true);
    const { data, error: err } = await supabase.rpc("request_sale_return", {
      p_source_type: sale.source_type, p_source_id: sale.source_id, p_lines: lines, p_reason: reason.trim(),
      p_refund_mode: paidSale ? mode : null, p_refund_employee_id: paidSale && mode === "cash" ? refunder : null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setDone(data);
    setSale(null);
    loadHistory();
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray }}>
        <Link href="/dashboard/stock/dental" style={{ color: theme.gray }}>Inventory Management</Link> &gt; Returns
      </p>
      <h1 style={{ color: theme.navy, margin: "4px 0" }}>Returns</h1>
      <p style={{ color: theme.gray, marginTop: 0 }}>
        When a doctor brings items back. Find the sale, choose what came back and why. It goes to an admin to approve; once approved,
        the items go back into stock and the amount comes off the clinic&apos;s account.
      </p>

      <div style={card}>
        <label style={lbl}>Receipt number</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={receipt} onChange={(e) => setReceipt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && find()}
            placeholder="RCPM-2026-00115" style={{ ...inp, marginBottom: 0, maxWidth: 280 }} />
          <button onClick={() => find()} disabled={busy} style={primaryBtn}>{busy ? "..." : "Find sale"}</button>
        </div>
        <p style={{ fontSize: 12, color: theme.gray, margin: "8px 0 0" }}>
          The receipt number is on the printed receipt, on the clinic&apos;s statement in Debt Collection, and in the recent sales on Counter Sale.
        </p>
        {error && <p style={errText}>{error}</p>}
        {done && (
          <p style={{ fontSize: 13, color: "#2e7d32", background: "#e8f5e9", padding: "10px 12px", borderRadius: 8, marginTop: 12 }}>
            Return of {money(done.total_value)} EGP sent for admin approval. Nothing changes in stock or on the account until it is approved.
          </p>
        )}
      </div>

      {sale && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, color: theme.navy, fontSize: 16 }}>
                {sale.receipt_no || (sale.source_type === "dental_order" ? "Doctor portal order" : "Sale")}
              </div>
              <div style={{ fontSize: 13, color: theme.gray }} dir="auto">
                {formatDate(sale.date)} · {sale.customer || "Customer"} · {METHOD[sale.payment_method] || sale.payment_method}
                {Number(sale.discount_percent) > 0 && ` · ${sale.discount_percent}% discount`}
              </div>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}>
            <thead>
              <tr>
                <th style={th}>Item</th>
                <th style={{ ...th, textAlign: "right" }}>Sold</th>
                <th style={{ ...th, textAlign: "right" }}>Already returned</th>
                <th style={{ ...th, textAlign: "right" }}>Unit price</th>
                <th style={{ ...th, textAlign: "right", width: 110 }}>Returning now</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => (
                <tr key={l.stock_item_id}>
                  <td style={td} dir="auto">{l.item_name}</td>
                  <td style={{ ...td, textAlign: "right" }}>{qtyText(l.sold)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{Number(l.returned) > 0 ? qtyText(l.returned) : "-"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{money(l.unit_price)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {Number(l.returnable) > 0 ? (
                      <input type="number" min="0" max={l.returnable} value={qty[l.stock_item_id] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [l.stock_item_id]: e.target.value }))}
                        placeholder={`max ${qtyText(l.returnable)}`} style={{ ...inp, marginBottom: 0, width: 96, textAlign: "right" }} />
                    ) : <span style={{ color: theme.gray, fontSize: 12 }}>All returned</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sale.lines.some((l) => Number(l.returnable) > 0) && (
            <button type="button" style={{ ...ghostBtn, marginTop: 10 }}
              onClick={() => setQty(Object.fromEntries(sale.lines.map((l) => [l.stock_item_id, String(l.returnable)])))}>
              Return the whole order
            </button>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#f7f7f8", borderRadius: 8, margin: "14px 0" }}>
            <span style={{ fontWeight: 600, color: theme.navy }}>Value of this return</span>
            <span style={{ fontWeight: 800, color: theme.navy }}>{money(total)} EGP</span>
          </div>

          <label style={lbl}>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong size, damaged, not needed" style={inp} />

          {sale.on_account && <p style={note}>This sale was on the clinic&apos;s account, so the amount comes off what the clinic owes.</p>}
          {sale.staff_tab && <p style={note}>This sale was on a staff tab, so the amount comes off that employee&apos;s tab.</p>}
          {paidSale && (
            <>
              <label style={lbl}>The sale was already paid. Give the money back as</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={() => setMode("credit")} style={{ ...toggle, ...(mode === "credit" ? toggleOn : {}) }}>Credit on the clinic&apos;s account</button>
                <button type="button" onClick={() => setMode("cash")} style={{ ...toggle, ...(mode === "cash" ? toggleOn : {}) }}>Cash refund</button>
              </div>
              {mode === "cash" && (
                <>
                  <label style={lbl}>Who hands the cash back</label>
                  <select value={refunder} onChange={(e) => setRefunder(e.target.value)} style={inp}>
                    <option value="">Choose...</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <p style={{ ...note, marginTop: -6 }}>Once approved, it comes out of that person&apos;s cash in hand.</p>
                </>
              )}
            </>
          )}

          {error && <p style={errText}>{error}</p>}
          <button onClick={submit} disabled={busy} style={{ ...primaryBtn, width: "100%", marginTop: 8 }}>
            {busy ? "Sending..." : "Send for admin approval"}
          </button>
        </div>
      )}

      <div style={{ ...card, marginTop: 16 }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Recent returns</h3>
        {history.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No returns yet.</p>}
        {history.map((r) => {
          const st = STATUS_STYLE[r.status] || STATUS_STYLE.pending;
          return (
            <div key={r.id} style={{ padding: "10px 0", borderTop: "1px solid #f0f0f3", fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: theme.navy }} dir="auto">
                  {r.receipt_no || "Portal order"} · {r.customer_label || ""}
                </span>
                <span>
                  <strong style={{ color: theme.navy }}>{money(r.total_value)} EGP</strong>{" "}
                  <span style={{ ...badge, background: st.background, color: st.color }}>{st.label}</span>
                </span>
              </div>
              <div style={{ color: theme.gray, fontSize: 12 }} dir="auto">
                {(r.sale_return_lines || []).map((l) => `${l.item_name} ×${qtyText(l.qty)}`).join(", ")}
              </div>
              <div style={{ color: theme.gray, fontSize: 11 }}>
                {formatDate(r.requested_at)} · by {r.requested_by_name || "-"} · {MODE_LABEL[r.refund_mode]} · {r.reason}
                {r.decided_by_name && ` · ${r.status} by ${r.decided_by_name}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const card = { background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };
const lbl = { fontSize: 12, fontWeight: 600, color: theme.navy, display: "block", marginBottom: 6 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 14 };
const primaryBtn = { padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
const ghostBtn = { padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontWeight: 600, fontSize: 12, cursor: "pointer" };
const toggle = { padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 13, cursor: "pointer" };
const toggleOn = { border: `1px solid ${theme.gold}`, background: theme.goldLight, fontWeight: 700 };
const th = { textAlign: "left", padding: "8px 8px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #eee" };
const td = { padding: "8px", borderBottom: "1px solid #f3f3f3", color: theme.navy, verticalAlign: "middle" };
const badge = { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, display: "inline-block" };
const note = { fontSize: 12, color: theme.navy, background: "#f6efdd", padding: "10px 12px", borderRadius: 8 };
const errText = { fontSize: 12, color: "#b42318", margin: "10px 0 0" };
