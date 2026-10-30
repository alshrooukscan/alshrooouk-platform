"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { useT, tx, Ltr } from "../lib/i18n";

// Report pricing for an external client, and what their reports come to each
// month (Mohamed Said, 30 Oct 2026). Prices are per scan type: this client's
// own price, or the default for clients set on the scan type. Nothing here
// charges the client; it shows the bill so it can be checked and sent.

const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 16 };
const th = { textAlign: "start", padding: "7px 8px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #eee" };
const td = { padding: "7px 8px", fontSize: 13, color: theme.navy, borderBottom: "1px solid #f4f4f4" };
const inp = { width: 110, padding: "7px 9px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 };
const money = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

function monthBounds(m) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, "0")}`];
}

export default function ClientReportPricing({ client }) {
  const { t } = useT();
  const [types, setTypes] = useState([]);
  const [prices, setPrices] = useState({});
  const [draft, setDraft] = useState({});
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [reports, setReports] = useState([]);
  const [msg, setMsg] = useState("");
  const [msgVars, setMsgVars] = useState(null);
  const [busy, setBusy] = useState(false);
  const [charging, setCharging] = useState(false);
  const [rpcError, setRpcError] = useState("");

  async function loadPrices() {
    const [{ data: et }, { data: cp }] = await Promise.all([
      // Only the scans eligible for reports in the Reports Rule Center.
      supabase.from("exam_types").select("id, name, category, default_client_report_price, counts_in_report_baseline, is_active").eq("is_active", true).eq("counts_in_report_baseline", true).order("name"),
      supabase.from("client_report_prices").select("exam_type_id, price").eq("client_id", client.id),
    ]);
    setTypes(et || []);
    const map = Object.fromEntries((cp || []).map((p) => [p.exam_type_id, Number(p.price)]));
    setPrices(map);
    setDraft(Object.fromEntries((et || []).map((t) => [t.id, map[t.id] ?? ""])));
  }
  async function loadReports() {
    const [from, to] = monthBounds(month);
    const { data, error } = await supabase.rpc("client_reports_priced", { p_client_id: client.id, p_from: from, p_to: to });
    setRpcError(error ? error.message : "");
    setReports(data || []);
    const { data: all } = await supabase.rpc("client_reports_priced", { p_client_id: client.id, p_from: "2000-01-01", p_to: "2100-01-01" });
    const due = (all || []).filter((r) => r.status === "completed" && !r.charged && r.price != null && Number(r.price) > 0);
    setUncharged({ count: due.length, amount: due.reduce((s, r) => s + Number(r.price), 0) });
  }
  const [uncharged, setUncharged] = useState({ count: 0, amount: 0 });

  async function chargeUncharged() {
    if (!confirm(tx(uncharged.count === 1 ? "Charge {n} finished report to {name}'s account, {amount} EGP in total?" : "Charge {n} finished reports to {name}'s account, {amount} EGP in total?", { n: uncharged.count, name: client.name, amount: money(uncharged.amount) }))) return;
    setCharging(true);
    const { data: s } = await supabase.auth.getSession();
    const { data, error } = await supabase.rpc("client_charge_uncharged", { p_client_id: client.id, p_by: s?.session?.user?.email || "Staff" });
    setCharging(false);
    if (error) { setMsgVars(null); setMsg(error.message); return; }
    setMsgVars({ n: data.count, amount: money(data.amount), name: client.name });
    setMsg(data.count === 1 ? "Charged {n} report, {amount} EGP. They are on {name}'s account in Debt Collection." : "Charged {n} reports, {amount} EGP. They are on {name}'s account in Debt Collection.");
    loadReports();
  }
  useEffect(() => { loadPrices(); }, [client.id]);
  useEffect(() => { loadReports(); }, [client.id, month, prices]);

  async function savePrices() {
    setBusy(true); setMsg(""); setMsgVars(null);
    const { data: s } = await supabase.auth.getSession();
    const me = s?.session?.user?.email || null;
    const upserts = [], deletes = [];
    for (const t of types) {
      const v = draft[t.id];
      const had = prices[t.id];
      if (v === "" || v === null || v === undefined) { if (had !== undefined) deletes.push(t.id); continue; }
      const n = Number(v);
      if (!isFinite(n) || n < 0) { setBusy(false); setMsgVars({ name: t.name }); setMsg('"{name}": enter a price of zero or more.'); return; }
      if (had !== n) upserts.push({ client_id: client.id, exam_type_id: t.id, price: n, updated_at: new Date().toISOString(), updated_by_name: me });
    }
    if (upserts.length) {
      const { error } = await supabase.from("client_report_prices").upsert(upserts, { onConflict: "client_id,exam_type_id" });
      if (error) { setBusy(false); setMsgVars(null); setMsg(error.message); return; }
    }
    if (deletes.length) await supabase.from("client_report_prices").delete().eq("client_id", client.id).in("exam_type_id", deletes);
    setBusy(false);
    setMsg(upserts.length || deletes.length ? "Prices saved." : "Nothing changed.");
    loadPrices();
  }

  const summary = useMemo(() => {
    const by = {};
    for (const r of reports) {
      const k = r.exam_type_name || `Unmatched: ${r.scan_name}`;
      by[k] ||= { name: k, count: 0, price: r.price, total: 0, unpriced: 0, charged: 0, source: r.price_source };
      by[k].count += 1;
      if (r.charged) by[k].charged += 1;
      if (r.price === null || r.price === undefined) by[k].unpriced += 1; else by[k].total += Number(r.price);
    }
    const rows = Object.values(by).sort((a, b) => b.count - a.count);
    return { rows, total: rows.reduce((s, x) => s + x.total, 0), count: reports.length, unpriced: rows.reduce((s, x) => s + x.unpriced, 0) };
  }, [reports]);

  return (
    <>
      <div style={card}>
        <h3 style={{ color: theme.navy, margin: "0 0 4px", fontSize: 15 }}>{t("Report prices")}</h3>
        <p style={{ color: theme.gray, fontSize: 12, margin: "0 0 12px" }}>
          {t("What {name} pays per report, by scan type. A finished report is charged to their account at this price automatically.", { name: client.name })}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>{t("Scan type")}</th><th style={th}>{t("Report price (EGP)")}</th></tr></thead>
            <tbody>
              {types.map((ty) => (
                <tr key={ty.id}>
                  <td style={td}>{ty.name}</td>
                  <td style={td}>
                    <input type="number" min="0" step="1" style={inp} value={draft[ty.id] ?? ""}
                      placeholder={ty.default_client_report_price != null ? String(ty.default_client_report_price) : t("price")}
                      onChange={(e) => setDraft({ ...draft, [ty.id]: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
          <button onClick={savePrices} disabled={busy}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {busy ? t("Saving...") : t("Save prices")}
          </button>
          {msg && <span style={{ fontSize: 12, color: msg.includes("saved") || msg.includes("Nothing") || msg.startsWith("Charged") ? "#1e7a3c" : "#ba1a1a" }}>{t(msg, msgVars || undefined)}</span>}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div>
            <h3 style={{ color: theme.navy, margin: 0, fontSize: 15 }}>{t("Reports and what they come to")}</h3>
            <p style={{ color: theme.gray, fontSize: 12, margin: "2px 0 0" }}>{t("Reports {name} sent in the month, at their report prices. Each finished report is charged to their account automatically.", { name: client.name })}</p>
          </div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...inp, width: 150 }} />
        </div>
        {rpcError && <p style={{ fontSize: 12, color: "#ba1a1a" }}>{t("Could not load the reports:")} {rpcError}</p>}
        {uncharged.count > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff8e1", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: "#6b5200" }}>
              {t(uncharged.count === 1 ? "{n} finished report is not on their account yet ({amount} EGP), finished before a price was set." : "{n} finished reports are not on their account yet ({amount} EGP), finished before a price was set.", { n: uncharged.count, amount: money(uncharged.amount) })}
            </span>
            <button onClick={chargeUncharged} disabled={charging}
              style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              {charging ? t("Charging...") : t("Charge them ({amount} EGP)", { amount: money(uncharged.amount) })}
            </button>
          </div>
        )}
        {summary.count === 0 ? (
          <p style={{ fontSize: 13, color: theme.gray, margin: 0 }}>{t("No reports from {name} this month.", { name: client.name })}</p>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>{t("Scan type")}</th><th style={th}>{t("Reports")}</th><th style={th}>{t("Report price")}</th><th style={th}>{t("Total")}</th><th style={th}>{t("On their account")}</th></tr></thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.name}>
                    <td style={td}>{r.name.startsWith("Unmatched: ") ? t("Unmatched: {scan}", { scan: r.name.slice(11) }) : r.name}</td>
                    <td style={td}>{r.count}</td>
                    <td style={td}>{r.price != null ? `${money(r.price)}${r.source === "default" ? ` ${t("(default)")}` : ""}` : <span style={{ color: "#ba1a1a" }}>{t("no price set")}</span>}</td>
                    <td style={{ ...td, fontWeight: 700 }}><Ltr>{money(r.total)} {t("EGP")}</Ltr></td>
                    <td style={{ ...td, color: r.charged === r.count ? "#1e7a3c" : "#8a6d00" }}>{t("{a} of {b}", { a: r.charged, b: r.count })}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 800 }}>{t("Total")}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{summary.count}</td>
                  <td style={td}></td>
                  <td style={{ ...td, fontWeight: 800, fontSize: 15 }}><Ltr>{money(summary.total)} {t("EGP")}</Ltr></td>
                  <td style={td}></td>
                </tr>
              </tbody>
            </table>
            {summary.unpriced > 0 && (
              <p style={{ fontSize: 12, color: "#ba1a1a", margin: "8px 0 0" }}>
                {t(summary.unpriced === 1 ? "{n} report has no price yet and is not in the total. Set the price above." : "{n} reports have no price yet and are not in the total. Set the price above.", { n: summary.unpriced })}
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
