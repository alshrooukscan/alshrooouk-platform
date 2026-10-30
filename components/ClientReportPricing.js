"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";

// Report pricing for an external client, and what their reports come to each
// month (Mohamed Said, 30 Oct 2026). Prices are per scan type: this client's
// own price, or the default for clients set on the scan type. Nothing here
// charges the client; it shows the bill so it can be checked and sent.

const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 16 };
const th = { textAlign: "left", padding: "7px 8px", fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #eee" };
const td = { padding: "7px 8px", fontSize: 13, color: theme.navy, borderBottom: "1px solid #f4f4f4" };
const inp = { width: 110, padding: "7px 9px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 };
const money = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

function monthBounds(m) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, "0")}`];
}

export default function ClientReportPricing({ client }) {
  const [types, setTypes] = useState([]);
  const [prices, setPrices] = useState({});
  const [draft, setDraft] = useState({});
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [reports, setReports] = useState([]);
  const [msg, setMsg] = useState("");
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
    if (!confirm(`Charge ${uncharged.count} finished report${uncharged.count === 1 ? "" : "s"} to ${client.name}'s account, ${money(uncharged.amount)} EGP in total?`)) return;
    setCharging(true);
    const { data: s } = await supabase.auth.getSession();
    const { data, error } = await supabase.rpc("client_charge_uncharged", { p_client_id: client.id, p_by: s?.session?.user?.email || "Staff" });
    setCharging(false);
    if (error) { setMsg(error.message); return; }
    setMsg(`Charged ${data.count} report${data.count === 1 ? "" : "s"}, ${money(data.amount)} EGP. They are on ${client.name}'s account in Debt Collection.`);
    loadReports();
  }
  useEffect(() => { loadPrices(); }, [client.id]);
  useEffect(() => { loadReports(); }, [client.id, month, prices]);

  async function savePrices() {
    setBusy(true); setMsg("");
    const { data: s } = await supabase.auth.getSession();
    const me = s?.session?.user?.email || null;
    const upserts = [], deletes = [];
    for (const t of types) {
      const v = draft[t.id];
      const had = prices[t.id];
      if (v === "" || v === null || v === undefined) { if (had !== undefined) deletes.push(t.id); continue; }
      const n = Number(v);
      if (!isFinite(n) || n < 0) { setBusy(false); setMsg(`"${t.name}": enter a price of zero or more.`); return; }
      if (had !== n) upserts.push({ client_id: client.id, exam_type_id: t.id, price: n, updated_at: new Date().toISOString(), updated_by_name: me });
    }
    if (upserts.length) {
      const { error } = await supabase.from("client_report_prices").upsert(upserts, { onConflict: "client_id,exam_type_id" });
      if (error) { setBusy(false); setMsg(error.message); return; }
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
        <h3 style={{ color: theme.navy, margin: "0 0 4px", fontSize: 15 }}>Report prices · تسعير التقارير</h3>
        <p style={{ color: theme.gray, fontSize: 12, margin: "0 0 12px" }}>
          What {client.name} pays per report, by scan type. A finished report is charged to their account at this price automatically.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Scan type</th><th style={th}>Report price (EGP)</th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td style={td}>{t.name}</td>
                  <td style={td}>
                    <input type="number" min="0" step="1" style={inp} value={draft[t.id] ?? ""}
                      placeholder={t.default_client_report_price != null ? String(t.default_client_report_price) : "price"}
                      onChange={(e) => setDraft({ ...draft, [t.id]: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
          <button onClick={savePrices} disabled={busy}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {busy ? "Saving..." : "Save prices"}
          </button>
          {msg && <span style={{ fontSize: 12, color: msg.includes("saved") || msg.includes("Nothing") || msg.startsWith("Charged") ? "#1e7a3c" : "#ba1a1a" }}>{msg}</span>}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div>
            <h3 style={{ color: theme.navy, margin: 0, fontSize: 15 }}>Reports and what they come to · التقارير والحساب</h3>
            <p style={{ color: theme.gray, fontSize: 12, margin: "2px 0 0" }}>Reports {client.name} sent in the month, at their report prices. Each finished report is charged to their account automatically.</p>
          </div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...inp, width: 150 }} />
        </div>
        {rpcError && <p style={{ fontSize: 12, color: "#ba1a1a" }}>Could not load the reports: {rpcError}</p>}
        {uncharged.count > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff8e1", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: "#6b5200" }}>
              {uncharged.count} finished report{uncharged.count === 1 ? " is" : "s are"} not on their account yet ({money(uncharged.amount)} EGP), finished before a price was set.
            </span>
            <button onClick={chargeUncharged} disabled={charging}
              style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              {charging ? "Charging..." : `Charge them (${money(uncharged.amount)} EGP)`}
            </button>
          </div>
        )}
        {summary.count === 0 ? (
          <p style={{ fontSize: 13, color: theme.gray, margin: 0 }}>No reports from {client.name} this month.</p>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Scan type</th><th style={th}>Reports</th><th style={th}>Report price</th><th style={th}>Total</th><th style={th}>On their account</th></tr></thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.name}>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{r.count}</td>
                    <td style={td}>{r.price != null ? `${money(r.price)}${r.source === "default" ? " (default)" : ""}` : <span style={{ color: "#ba1a1a" }}>no price set</span>}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{money(r.total)} EGP</td>
                    <td style={{ ...td, color: r.charged === r.count ? "#1e7a3c" : "#8a6d00" }}>{r.charged} of {r.count}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 800 }}>Total</td>
                  <td style={{ ...td, fontWeight: 800 }}>{summary.count}</td>
                  <td style={td}></td>
                  <td style={{ ...td, fontWeight: 800, fontSize: 15 }}>{money(summary.total)} EGP</td>
                  <td style={td}></td>
                </tr>
              </tbody>
            </table>
            {summary.unpriced > 0 && (
              <p style={{ fontSize: 12, color: "#ba1a1a", margin: "8px 0 0" }}>
                {summary.unpriced} report{summary.unpriced === 1 ? " has" : "s have"} no price yet and {summary.unpriced === 1 ? "is" : "are"} not in the total. Set the price above.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
