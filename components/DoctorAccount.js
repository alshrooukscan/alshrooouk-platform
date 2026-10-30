"use client";
import { useState } from "react";
import { theme } from "../lib/theme";

// What a clinic's balance is made of, for the doctor (30 Oct 2026). Every item
// taken at reception or ordered from the portal, at the price charged, every
// payment and return, and the balance after each. Same lines as the statement
// reception prints, so the two can never disagree.

const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const date = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const METHOD = { cash: "Cash", visa: "Visa", instapay: "InstaPay", wallet: "Wallet", vodafone_cash: "Wallet" };

function Entry({ e }) {
  const isCharge = e.kind === "charge";
  const title = e.kind === "payment" ? "Payment · دفعة"
    : e.kind === "return" ? "Items returned · مرتجع"
    : e.label === "Sale" ? "Picked up at reception · استلام من الاستقبال"
    : e.label === "Order from the doctor portal" ? "Portal order · طلب من الموقع"
    : e.label.startsWith("Balance carried over") ? "Earlier balance · رصيد سابق"
    : e.label;
  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid #f0eee6" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}><bdi>{title}</bdi></div>
          <div style={{ fontSize: 11, color: theme.gray }}>
            {date(e.date)}{e.receipt_no ? ` · ${e.receipt_no}` : ""}{e.payment_method ? ` · ${METHOD[e.payment_method] || e.payment_method}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", color: isCharge ? "#ba1a1a" : "#1e7a3c" }}>
          {isCharge ? "+" : "−"} {money(e.amount)}
        </div>
      </div>
      {e.lines?.length > 0 && (
        <div style={{ marginTop: 6, background: "#faf9fb", borderRadius: 8, padding: "6px 10px" }}>
          {e.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0", color: theme.navy }}>
              <div style={{ minWidth: 0 }}>
                <div dir="auto" style={{ fontWeight: 600 }}>{l.item}</div>
                <div dir="ltr" style={{ color: theme.gray, fontSize: 11 }}>{Number(l.qty)} × {money(l.unit_price)} EGP</div>
              </div>
              <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{money(l.line_total)}</span>
            </div>
          ))}
          {e.difference !== 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: theme.gray }}>
              <span>{e.difference < 0 ? "Discount" : "Other charges"}</span><span>{money(e.difference)}</span>
            </div>
          )}
        </div>
      )}
      {!e.lines?.length && e.note && <div style={{ fontSize: 11, color: theme.gray, marginTop: 3 }} dir="auto">{e.note}</div>}
      <div style={{ fontSize: 10.5, color: theme.gray, textAlign: "right", marginTop: 3 }}>Balance after: {money(e.running)} EGP</div>
    </div>
  );
}

export default function DoctorAccount({ open = [], history = [], balance }) {
  const [show, setShow] = useState(false);
  const [all, setAll] = useState(false);
  if (!open.length && !history.length) return null;
  const taken = open.filter((e) => e.kind === "charge").reduce((s, e) => s + e.amount, 0);
  const paid = open.filter((e) => e.kind !== "charge").reduce((s, e) => s + e.amount, 0);
  const rows = (all ? [...history, ...open] : open).slice().reverse();
  return (
    <div style={{ marginTop: -8, marginBottom: 20 }}>
      <button onClick={() => setShow(!show)}
        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #eedfae", background: "#fffdf5", color: "#8a6d00", fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
        {show ? "▲" : "▼"} What is this for? · الحساب ده على إيه؟
      </button>
      {show && (
        <div style={{ background: "#fff", border: "1px solid #f0eee6", borderTop: "none", borderRadius: "0 0 12px 12px", padding: "8px 14px 12px" }}>
          {open.length > 0 && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: theme.navy, padding: "6px 0 8px" }}>
              <span>Taken <bdi>(المسحوب)</bdi>: <strong>{money(taken)}</strong></span>
              {paid > 0 && <span>Paid <bdi>(المدفوع)</bdi>: <strong style={{ color: "#1e7a3c" }}>{money(paid)}</strong></span>}
              <span>Remaining <bdi>(المتبقي)</bdi>: <strong style={{ color: "#ba1a1a" }}>{money(balance)} EGP</strong></span>
            </div>
          )}
          <div style={{ fontSize: 11, color: theme.gray, marginBottom: 2 }}>
            {all ? "Full history, newest first." : "Everything since your account was last clear, newest first."}
          </div>
          {rows.map((e) => <Entry key={e.id} e={e} />)}
          {history.length > 0 && (
            <button onClick={() => setAll(!all)}
              style={{ marginTop: 10, padding: "6px 12px", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {all ? "Show only what is open" : "Show earlier history (paid)"}
            </button>
          )}
          <div style={{ fontSize: 11, color: theme.gray, marginTop: 10 }}>
            Prices are as charged at the time. Questions? Ask reception for the printed statement.
          </div>
        </div>
      )}
    </div>
  );
}
