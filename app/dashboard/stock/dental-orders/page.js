"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { theme } from "../../../../lib/theme";
import { formatMoney } from "../../../../lib/format";

// vodafone_cash is the retired key for the same thing; both render as Wallet
const PAYMENT_LABEL = { cash: "Cash", visa: "Visa", instapay: "InstaPay", wallet: "Wallet", vodafone_cash: "Wallet" };
const METHODS = ["cash", "visa", "instapay", "wallet"];

const STATUS = {
  placed: { bg: "#fff8e1", fg: "#a97c00", label: "Awaiting review" },
  reviewed: { bg: "#e8eefc", fg: "#27214d", label: "Ready to deliver" },
  delivered: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Delivered" },
  cancelled: { bg: "#f0f0f0", fg: "#888", label: "Cancelled" },
  confirmed: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Delivered" },
};
const PAYSTATUS = {
  unpaid: { bg: "#fdecea", fg: "#ba1a1a", label: "Unpaid" },
  partial: { bg: "#fff8e1", fg: "#a97c00", label: "Part paid" },
  paid: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Paid" },
};

export default function DentalOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");
  const [payFor, setPayFor] = useState(null);
  const [verifyFor, setVerifyFor] = useState(null);
  const [code, setCode] = useState("");
  const [issuedCode, setIssuedCode] = useState(null);
  const [pay, setPay] = useState({ amount: "", method: "cash" });

  useEffect(() => { load(); }, []);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/dental-orders", { headers: { Authorization: `Bearer ${await token()}` } });
    const j = await res.json();
    if (res.ok) setOrders(j.orders || []);
    else setError(j.error || "Could not load orders");
    setLoading(false);
  }

  async function act(orderId, action, extra = {}) {
    setBusy(orderId);
    setError("");
    const res = await fetch("/api/admin/dental-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ orderId, action, ...extra }),
    });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) return setError(j.error || "Could not update that order.");
    // A13: the code goes to the customer over WhatsApp. Showing it here is
    // what lets the delivery person read it out or paste it into the chat.
    if (action === "assign" && j.result?.otp) setIssuedCode({ orderId, otp: j.result.otp, source: j.result.source });
    setPayFor(null);
    setPay({ amount: "", method: "cash" });
    load();
  }

  const live = orders.filter((o) => o.status !== "cancelled");
  const owedOn = (o) => Math.max(Number(o.total_amount || 0) - Number(o.amount_paid || 0), 0);
  const outstanding = live.reduce((s, o) => s + owedOn(o), 0);
  const collected = live.reduce((s, o) => s + Number(o.amount_paid || 0), 0);
  const ordered = live.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const awaitingReview = orders.filter((o) => o.status === "placed").length;
  const awaitingDelivery = orders.filter((o) => o.status === "reviewed").length;

  // Who owes what - the number that actually needs chasing.
  const byDoctor = {};
  for (const o of live) {
    const owed = owedOn(o);
    if (owed <= 0) continue;
    const k = o.doctors?.name || "Unknown doctor";
    byDoctor[k] = (byDoctor[k] || 0) + owed;
  }
  const debtors = Object.entries(byDoctor).sort((a, b) => b[1] - a[1]);

  const topItems = {};
  for (const o of live) {
    for (const it of o.dental_order_items || []) {
      topItems[it.item_name] = (topItems[it.item_name] || 0) + Number(it.quantity || 0);
    }
  }
  const items = Object.entries(topItems).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const shown = orders.filter((o) => {
    if (filter === "all") return true;
    if (filter === "open") return o.status !== "cancelled" && (o.payment_status !== "paid" || o.status === "placed");
    if (filter === "review") return o.status === "placed";
    return o.status === filter;
  });

  const card = { background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 2px 12px rgba(39,33,77,0.05)" };

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Dental Stock Orders</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        Orders doctors placed from their own portal — review, deliver, and record what was actually collected.
      </p>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 22 }}>
        {[
          { label: "Outstanding", value: `${formatMoney(outstanding)} EGP`, color: outstanding > 0 ? "#ba1a1a" : theme.navy },
          { label: "Collected", value: `${formatMoney(collected)} EGP`, color: "#1e7a3c" },
          { label: "Total ordered", value: `${formatMoney(ordered)} EGP`, color: theme.navy },
          { label: "Awaiting review", value: awaitingReview, color: awaitingReview ? "#a97c00" : theme.navy },
          { label: "Ready to deliver", value: awaitingDelivery, color: theme.navy },
        ].map((k) => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 10, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
        <div style={card}>
          <h3 style={{ margin: "0 0 10px", color: theme.navy, fontSize: 15 }}>Doctors with an unpaid balance</h3>
          {debtors.length === 0 && <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>Nobody owes anything.</p>}
          {debtors.map(([name, amt]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f2f2f2", fontSize: 13 }}>
              <span style={{ color: theme.navy, fontWeight: 600 }}>{name}</span>
              <span style={{ color: "#ba1a1a", fontWeight: 700 }}>{formatMoney(amt)} EGP</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <h3 style={{ margin: "0 0 10px", color: theme.navy, fontSize: 15 }}>Most ordered items</h3>
          {items.length === 0 && <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>Nothing ordered yet.</p>}
          {items.map(([name, qty]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f2f2f2", fontSize: 13 }}>
              <span style={{ color: theme.navy }}>{name}</span>
              <span style={{ color: theme.gray, fontWeight: 700 }}>{qty}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { k: "open", l: "Needs attention" },
          { k: "review", l: "Awaiting review" },
          { k: "delivered", l: "Delivered" },
          { k: "cancelled", l: "Cancelled" },
          { k: "all", l: "All" },
        ].map((f) => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: filter === f.k ? theme.navy : "#fff", color: filter === f.k ? "#fff" : theme.navy,
              boxShadow: "0 2px 8px rgba(39,33,77,0.06)" }}>
            {f.l}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && shown.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing here.</p>}

      {shown.map((o) => {
        const st = STATUS[o.status] || STATUS.placed;
        const ps = PAYSTATUS[o.payment_status] || PAYSTATUS.unpaid;
        const owed = owedOn(o);
        return (
          <div key={o.id} style={{ ...card, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                  {o.doctors?.name || "Unknown doctor"}
                  {o.doctors?.clinic_code && <span style={{ color: theme.gold, fontSize: 11, marginLeft: 6 }}>{o.doctors.clinic_code}</span>}
                </div>
                <div style={{ fontSize: 11, color: theme.gray }}>
                  {new Date(o.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {o.pay_later && <span style={{ color: "#a97c00", fontWeight: 700 }}> · asked to pay later</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: ps.bg, color: ps.fg }}>{ps.label}</span>
                <span style={{ fontWeight: 800, color: theme.navy, fontSize: 15 }}>{formatMoney(o.total_amount)} EGP</span>
              </div>
            </div>

            {owed > 0 && (
              <div style={{ fontSize: 12, color: "#ba1a1a", fontWeight: 700, marginTop: 6 }}>
                Outstanding: {formatMoney(owed)} EGP
                {Number(o.amount_paid) > 0 && <span style={{ color: theme.gray, fontWeight: 400 }}> (paid {formatMoney(o.amount_paid)})</span>}
              </div>
            )}

            <button onClick={() => setExpanded(expanded === o.id ? null : o.id)}
              style={{ marginTop: 8, background: "none", border: "none", color: theme.gold, fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 }}>
              {expanded === o.id ? "Hide items" : `Show ${(o.dental_order_items || []).length} items`}
            </button>

            {expanded === o.id && (
              <div style={{ marginTop: 8, background: "#faf9fb", borderRadius: 8, padding: 10 }}>
                {(o.dental_order_items || []).map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                    <span style={{ color: theme.navy }}>{it.item_name} × {it.quantity}</span>
                    <span style={{ color: theme.gray }}>{formatMoney(it.line_total)} EGP</span>
                  </div>
                ))}
              </div>
            )}

            {issuedCode?.orderId === o.id && (
              <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: "#eef4f6", border: "1px solid #cfe0e6" }}>
                <div style={{ fontSize: 11, color: "#48464E", fontWeight: 700 }}>
                  Delivery code for the customer{issuedCode.source === "manual" ? "" : ` \u00b7 auto-assigned (${issuedCode.source})`}
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 6, color: theme.navy }}>{issuedCode.otp}</div>
                <div style={{ fontSize: 11, color: "#48464E" }}>
                  Send this to the customer on WhatsApp. They read it back on delivery.
                </div>
                <button onClick={() => setIssuedCode(null)} style={{ ...btn("#fff", theme.gray), marginTop: 6 }}>Hide</button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {o.status === "placed" && (
                <button onClick={() => act(o.id, "review")} disabled={busy === o.id} style={btn(theme.navy, "#fff")}>Mark Reviewed</button>
              )}
              {["placed", "reviewed"].includes(o.status) && (
                <button onClick={() => act(o.id, "assign")} disabled={busy === o.id} style={btn(theme.navy, "#fff")}>
                  Assign &amp; Send Code
                </button>
              )}
              {o.status === "in_transit" && (
                <>
                  <button onClick={() => setVerifyFor(verifyFor === o.id ? null : o.id)} disabled={busy === o.id} style={btn("#1e7a3c", "#fff")}>
                    Enter Customer Code
                  </button>
                  <button
                    onClick={() => {
                      const reason = prompt("Closing without the customer's code. Why? (recorded and flagged for review)");
                      if (reason && reason.trim().length >= 5) act(o.id, "override", { reason });
                      else if (reason !== null) alert("Please give a fuller reason.");
                    }}
                    disabled={busy === o.id}
                    style={{ ...btn("#fff", "#8a6d00"), border: "1px solid #e6d08a" }}
                  >
                    Manager Override
                  </button>
                </>
              )}
              {o.status !== "cancelled" && owed > 0 && (o.status === "delivered" || o.is_on_behalf) && (
                <button
                  onClick={() => { setPayFor(payFor === o.id ? null : o.id); setPay({ amount: String(owed), method: o.payment_method || "cash" }); }}
                  disabled={busy === o.id} style={btn(theme.gold, theme.navy)}>Record Payment</button>
              )}
              {o.status === "in_transit" && owed > 0 && (
                <span style={{ fontSize: 11, color: "#8a6d00", alignSelf: "center" }}>
                  Payment unlocks once the delivery is verified.
                </span>
              )}
              {o.status !== "delivered" && o.status !== "cancelled" && Number(o.amount_paid) === 0 && (
                <button onClick={() => { if (confirm("Cancel this order? The items go back into stock.")) act(o.id, "cancel"); }}
                  disabled={busy === o.id} style={{ ...btn("#fff", "#ba1a1a"), border: "1px solid #f0c9c9" }}>Cancel</button>
              )}
            </div>

            {verifyFor === o.id && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, background: "#f2f8f4", padding: 12, borderRadius: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#48464E", fontWeight: 700, marginBottom: 3 }}>4-digit code from the customer</div>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    placeholder="0000"
                    style={{ width: 90, padding: "7px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 15, letterSpacing: 3, textAlign: "center" }}
                  />
                </div>
                <button
                  onClick={() => { act(o.id, "verify", { code }); setCode(""); }}
                  disabled={busy === o.id || code.length !== 4}
                  style={btn("#1e7a3c", "#fff")}
                >
                  Verify Delivery
                </button>
                <button onClick={() => { setVerifyFor(null); setCode(""); }} style={btn("#fff", theme.gray)}>Cancel</button>
              </div>
            )}

            {payFor === o.id && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, background: "#faf9fb", padding: 12, borderRadius: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#48464E", fontWeight: 700, marginBottom: 3 }}>Amount collected</div>
                  <input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                    style={{ width: 110, padding: "7px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#48464E", fontWeight: 700, marginBottom: 3 }}>Method</div>
                  <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}
                    style={{ padding: "7px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
                    {METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
                  </select>
                </div>
                <button onClick={() => act(o.id, "pay", { amount: Number(pay.amount), paymentMethod: pay.method })}
                  disabled={busy === o.id} style={btn(theme.navy, "#fff")}>
                  {busy === o.id ? "Saving..." : "Confirm"}
                </button>
                <span style={{ fontSize: 11, color: theme.gray, width: "100%" }}>
                  Cash is added to your own Cash In Hand. Card, InstaPay and Wallet are recorded but never enter anyone&apos;s hand.
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function btn(bg, fg) {
  return { padding: "7px 16px", borderRadius: 8, border: "none", background: bg, color: fg, fontWeight: 700, fontSize: 12, cursor: "pointer" };
}
