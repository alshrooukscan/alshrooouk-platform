"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { useT, tx, Ltr } from "../lib/i18n";

// What a client owes us, and settling it from their page (Mohamed Said,
// 30 Oct 2026). Payments go through the same /api/ar path as Debt Collection,
// so the receipt number, cash custody and ledger row are written together.

const money = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const METHODS = [["cash", "Cash"], ["visa", "Visa"], ["instapay", "InstaPay"], ["wallet", "Wallet"]];
const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 16 };
const inp = { padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" };

export default function ClientAccountCard({ client }) {
  const { t } = useT();
  const [balance, setBalance] = useState(null);
  const [byBrand, setByBrand] = useState({});
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);

  async function load() {
    const { data } = await supabase.from("customer_ar_ledger").select("brand, direction, amount").eq("customer_type", "client").eq("customer_id", client.id);
    const b = {};
    for (const l of data || []) b[l.brand] = (b[l.brand] || 0) + (l.direction === "charge" ? Number(l.amount) : -Number(l.amount));
    for (const k of Object.keys(b)) b[k] = Math.round(b[k] * 100) / 100;
    setByBrand(b);
    setBalance(Math.round(Object.values(b).reduce((s, v) => s + v, 0) * 100) / 100);
  }
  useEffect(() => { load(); }, [client.id]);

  const scanOwed = byBrand.scan || 0;

  async function pay() {
    setError("");
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError(tx("Enter the amount received."));
    if (Math.round(amt * 100) > Math.round(scanOwed * 100)) return setError(tx("That is more than the {amount} EGP they owe.", { amount: money(scanOwed) }));
    if (method === "cash" && !ack) return setError(tx("Please confirm the cash has been received."));
    setBusy(true);
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch("/api/ar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s?.session?.access_token}` },
      body: JSON.stringify({ action: "payment", customerType: "client", customerId: client.id, brand: "scan", amount: amt, paymentMethod: method, cashAcknowledged: ack, note: note || null }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || tx("Could not record the payment."));
    setReceipt(j.result || {});
    setOpen(false); setAmount(""); setAck(false); setNote("");
    load();
  }

  if (balance === null) return null;
  return (
    <div style={{ ...card, borderInlineStart: `4px solid ${scanOwed > 0 ? "#ba1a1a" : "#1e7a3c"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ color: theme.navy, margin: 0, fontSize: 15 }}>{t("Account")}</h3>
          <div style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>{t("What {name} owes for reports.", { name: client.name })}</div>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: scanOwed > 0 ? "#ba1a1a" : "#1e7a3c" }}><Ltr>{money(scanOwed)} {t("EGP")}</Ltr></div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {scanOwed > 0 && (
          <button onClick={() => { setOpen(!open); setError(""); setReceipt(null); }}
            style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {open ? t("Cancel") : t("Record payment")}
          </button>
        )}
        <a href={`/dashboard/debt-collection/statement/${client.id}/scan`} target="_blank" rel="noreferrer"
          style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${theme.navy}`, color: theme.navy, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
          {t("Statement")}
        </a>
      </div>

      {open && (
        <div style={{ marginTop: 14, background: "#faf9fb", borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: theme.navy, marginBottom: 6 }}>{t("Amount received (EGP)")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inp, width: 160 }} />
            <button onClick={() => setAmount(String(scanOwed))} style={{ ...inp, cursor: "pointer", fontWeight: 700, color: theme.navy, background: "#fff" }}>{t("Full balance")}</button>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={inp}>
              {METHODS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </div>
          <input placeholder={t("Note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: "100%", marginTop: 8 }} />
          {method === "cash" && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontSize: 12.5, color: theme.navy }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 2 }} />
              {t("I confirm I received this cash. It goes into my cash in hand until I hand it over.")}
            </label>
          )}
          {Number(amount) > 0 && Number(amount) <= scanOwed && (
            <div style={{ fontSize: 12, color: theme.gray, marginTop: 8 }}>{t("Remaining after this payment:")} <strong><Ltr>{money(scanOwed - Number(amount))} {t("EGP")}</Ltr></strong></div>
          )}
          {error && <p style={{ color: "#ba1a1a", fontSize: 12.5, margin: "8px 0 0" }}>{t(error)}</p>}
          <button onClick={pay} disabled={busy}
            style={{ marginTop: 10, padding: "9px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {busy ? t("Recording...") : t("Record payment")}
          </button>
        </div>
      )}

      {receipt && (
        <div style={{ marginTop: 12, background: "#e7f6ec", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1e5c33", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>{t("Payment recorded")}{receipt.receipt_no ? <> · <Ltr>{receipt.receipt_no}</Ltr></> : ""}. {t("Remaining {amount} EGP.", { amount: money(receipt.outstanding ?? scanOwed) })}</span>
          {receipt.ledger_id && (
            <a href={`/dashboard/debt-collection/statement/${client.id}/scan?payment=${receipt.ledger_id}`} target="_blank" rel="noreferrer"
              style={{ fontWeight: 700, color: theme.navy }}>{t("Print invoice")}</a>
          )}
        </div>
      )}
    </div>
  );
}
