"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../../lib/supabase";
import { theme } from "../../../../../../lib/theme";
import { formatMoney } from "../../../../../../lib/format";

// Account statement: what a clinic took, at what price, what it paid, and what
// it still owes. Laid out for A4, so it can be printed or saved as a PDF and
// sent to the doctor.

const BRAND_LABEL = { scan: "Scan Center", dental_stock: "Dental Supply", el3awama_stock: "El3awama F&B" };
const METHOD_LABEL = { cash: "Cash", visa: "Visa", instapay: "InstaPay", wallet: "Wallet", vodafone_cash: "Wallet" };

function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "-";
}
const money = (n) => formatMoney(n, { decimals: 2 });
const qtyText = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function AccountStatementPage() {
  const { customerId, brand } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch(`/api/ar/statement?customerId=${customerId}&brand=${brand}`, {
        headers: { Authorization: `Bearer ${s?.session?.access_token || ""}` },
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Could not load the statement.");
      setData(json);
    })();
  }, [customerId, brand]);

  // A period can be chosen. Everything before it is carried in as one opening
  // line, so the balance at the bottom is always the real one.
  const view = useMemo(() => {
    if (!data) return null;
    const signed = (e) => (e.kind === "charge" ? e.amount : -e.amount);
    const before = data.entries.filter((e) => from && e.date < from);
    const inRange = data.entries.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
    const opening = before.reduce((s, e) => s + signed(e), 0);
    let running = opening;
    const rows = inRange.map((e) => {
      running += signed(e);
      return { ...e, running: Math.round(running * 100) / 100 };
    });
    const charged = inRange.filter((e) => e.kind === "charge").reduce((s, e) => s + e.amount, 0);
    const paid = inRange.filter((e) => e.kind !== "charge" && e.kind !== "return").reduce((s, e) => s + e.amount, 0);
    const returned = inRange.filter((e) => e.kind === "return").reduce((s, e) => s + e.amount, 0);
    return { rows, opening: Math.round(opening * 100) / 100, charged, paid, returned, closing: Math.round(running * 100) / 100 };
  }, [data, from, to]);

  if (error) return <p style={{ padding: 24, color: "#ba1a1a" }}>{error}</p>;
  if (!data || !view) return <p style={{ padding: 24, color: theme.gray }}>Loading...</p>;
  const c = data.customer;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

  return (
    <div style={{ background: "#fff", maxWidth: 900, margin: "0 auto", padding: 32, color: theme.navy }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          aside, nav { display: none !important; }
          tr { break-inside: avoid; }
        }
        @page { size: A4; margin: 12mm; }
      `}</style>

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 20, padding: 12, background: "#f7f7f8", borderRadius: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={lbl}>From<input type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} style={inp} /></label>
          <label style={lbl}>To<input type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} style={inp} /></label>
          {(from || to) && <button onClick={() => { setFrom(""); setTo(""); }} style={ghostBtn}>Whole account</button>}
        </div>
        <button onClick={() => window.print()} style={printBtn}>Print / Save as PDF</button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `3px solid ${theme.gold}`, paddingBottom: 14 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Al Shrooouk Scan &amp; Lab</div>
          <div style={{ fontSize: 13, color: theme.gray }}>{BRAND_LABEL[data.brand] || data.brand}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Account Statement</div>
          <div style={{ fontSize: 13, color: theme.gray }}>كشف حساب</div>
          <div style={{ fontSize: 12, color: theme.gray, marginTop: 4 }}>
            {from || to ? `${from ? formatDate(from) : "Start"} to ${formatDate(to || today)}` : `As of ${formatDate(today)}`}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, margin: "18px 0", fontSize: 13, flexWrap: "wrap" }}>
        <div>
          <div style={smallCap}>Account</div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {c.clinic_code && <span style={{ background: theme.goldLight, padding: "1px 8px", borderRadius: 999, marginRight: 6, fontSize: 13 }}>{c.clinic_code}</span>}
            {c.name}
          </div>
          {c.doctors?.length > 0 && <div dir="auto">{c.doctors.join(" · ")}</div>}
          {c.phone && <div style={{ color: theme.gray }}>{c.phone}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={smallCap}>Balance due</div>
          <div style={{ fontWeight: 800, fontSize: 24, color: view.closing > 0 ? "#ba1a1a" : "#2e7d32" }}>{money(view.closing)} EGP</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: theme.navy, color: "#fff" }}>
            <th style={{ ...th, width: 82 }}>Date</th>
            <th style={{ ...th, textAlign: "left" }}>Details</th>
            <th style={{ ...th, width: 44 }}>Qty</th>
            <th style={{ ...th, width: 84 }}>Unit price</th>
            <th style={{ ...th, width: 92 }}>Charged</th>
            <th style={{ ...th, width: 92 }}>Paid / returned</th>
            <th style={{ ...th, width: 98 }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {from && (
            <tr style={{ background: "#faf7ef" }}>
              <td style={td}>{formatDate(from)}</td>
              <td style={{ ...td, textAlign: "left", fontWeight: 700 }} colSpan={5}>Balance brought forward</td>
              <td style={{ ...td, fontWeight: 700 }}>{money(view.opening)}</td>
            </tr>
          )}
          {view.rows.length === 0 && (
            <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: theme.gray, padding: 20 }}>Nothing in this period.</td></tr>
          )}
          {view.rows.map((e) => (
            <Fragment key={e.id}>
              <tr style={{ background: e.kind === "charge" ? "#fff" : e.kind === "return" ? "#fff8ec" : "#f3faf4", borderTop: "1px solid #e6e6ea" }}>
                <td style={td}>{formatDate(e.date)}</td>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>
                  {e.label}
                  {e.receipt_no && <span style={{ fontWeight: 400, color: theme.gray }}> · {e.receipt_no}</span>}
                  {e.payment_method && <span style={{ fontWeight: 400, color: theme.gray }}> · {METHOD_LABEL[e.payment_method] || e.payment_method}</span>}
                  {e.note && <div style={{ fontWeight: 400, color: theme.gray, fontSize: 11 }} dir="auto">{e.note}</div>}
                  {/* Starts a return for this sale. Hidden on paper. */}
                  {e.kind === "charge" && (e.reference_type === "counter_sale" || e.reference_type === "dental_order") && (
                    <a className="no-print" target="_blank" rel="noreferrer"
                      href={e.reference_type === "counter_sale" && e.receipt_no
                        ? `/dashboard/stock/returns?receipt=${encodeURIComponent(e.receipt_no)}`
                        : `/dashboard/stock/returns?source=${e.reference_type}&id=${e.reference_id}`}
                      style={{ display: "inline-block", marginTop: 2, fontWeight: 400, fontSize: 11, color: theme.navy, textDecoration: "underline" }}>
                      Return items
                    </a>
                  )}
                </td>
                <td style={td}></td>
                <td style={td}></td>
                <td style={{ ...td, fontWeight: 700 }}>{e.kind === "charge" ? money(e.amount) : ""}</td>
                <td style={{ ...td, fontWeight: 700, color: "#2e7d32" }}>{e.kind !== "charge" ? money(e.amount) : ""}</td>
                <td style={{ ...td, fontWeight: 700 }}>{money(e.running)}</td>
              </tr>
              {e.lines.map((l, i) => (
                <tr key={i} style={{ color: theme.gray }}>
                  <td style={td}></td>
                  <td style={{ ...td, textAlign: "left", paddingLeft: 18 }} dir="auto">{l.item}</td>
                  <td style={td}>{qtyText(l.qty)}</td>
                  <td style={td}>{money(l.unit_price)}</td>
                  <td style={td}>{e.kind === "return" ? "" : money(l.line_total)}</td>
                  <td style={td}>{e.kind === "return" ? money(l.line_total) : ""}</td>
                  <td style={td}></td>
                </tr>
              ))}
              {e.difference !== 0 && (
                <tr style={{ color: theme.gray }}>
                  <td style={td}></td>
                  <td style={{ ...td, textAlign: "left", paddingLeft: 18 }}>{e.difference < 0 ? "Discount" : "Other charges"}</td>
                  <td style={td}></td>
                  <td style={td}></td>
                  <td style={td}>{money(e.difference)}</td>
                  <td style={td}></td>
                  <td style={td}></td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <table style={{ fontSize: 14, minWidth: 300 }}>
          <tbody>
            {from && <tr><td style={sumL}>Brought forward</td><td style={sumR}>{money(view.opening)} EGP</td></tr>}
            <tr><td style={sumL}>Total charged</td><td style={sumR}>{money(view.charged)} EGP</td></tr>
            <tr><td style={sumL}>Total paid</td><td style={{ ...sumR, color: "#2e7d32" }}>-{money(view.paid)} EGP</td></tr>
            {view.returned > 0 && <tr><td style={sumL}>Total returned</td><td style={{ ...sumR, color: "#a06000" }}>-{money(view.returned)} EGP</td></tr>}
            <tr style={{ borderTop: `2px solid ${theme.navy}` }}>
              <td style={{ ...sumL, fontWeight: 800, color: theme.navy }}>Balance due</td>
              <td style={{ ...sumR, fontWeight: 800, fontSize: 16, color: view.closing > 0 ? "#ba1a1a" : "#2e7d32" }}>{money(view.closing)} EGP</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: theme.gray, marginTop: 28 }}>
        Issued {formatDate(today)}{data.generated_by ? ` by ${data.generated_by}` : ""}. Prices are as charged at the time of each sale.
        {data.entries.some((e) => e.label.startsWith("Balance carried over")) && " Balances carried over from before the platform have no item breakdown."}
      </p>
    </div>
  );
}

const lbl = { fontSize: 11, fontWeight: 700, color: theme.navy, display: "flex", flexDirection: "column", gap: 4 };
const inp = { padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 };
const printBtn = { padding: "8px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" };
const ghostBtn = { alignSelf: "flex-end", padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, cursor: "pointer" };
const smallCap = { color: theme.gray, fontSize: 11, textTransform: "uppercase", fontWeight: 700 };
const th = { padding: "8px 8px", textAlign: "right", fontWeight: 700, fontSize: 11.5 };
const td = { padding: "5px 8px", textAlign: "right", verticalAlign: "top" };
const sumL = { padding: "4px 14px", color: theme.gray };
const sumR = { padding: "4px 0", textAlign: "right", fontWeight: 700 };
