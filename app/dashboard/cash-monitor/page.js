"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";
import { formatMoney } from "../../../lib/format";

const STATUS = {
  red:    { label: "Over limit",   bg: "#fff5f5", border: "#f0c9c9", text: "#ba1a1a" },
  yellow: { label: "Near limit",   bg: "#fffaf0", border: "#eddcb4", text: "#8a6d00" },
  green:  { label: "Fine",         bg: "#f6faf7", border: "#dbe7de", text: "#1e7a3c" },
  unset:  { label: "No limit set", bg: "#f6f7f8", border: "#e3e6e9", text: "#5a6570" },
};

// Staff Custody Live Monitor (spec section 8). Every active employee, the
// cash they hold for each business, and their status against the limit.
// A27: this is advisory. Nothing here blocks anyone from taking a payment.
export default function CashMonitorPage() {
  const { isAdmin, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [revenue, setRevenue] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin]);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    const [{ data: m }, { data: p }, { data: r }] = await Promise.all([
      supabase.from("staff_custody_monitor").select("*").order("total_cash", { ascending: false }),
      supabase.from("cash_handover_prompts").select("*"),
      supabase.from("daily_revenue_by_channel").select("*").gte("entry_date", since),
    ]);
    setRows(m || []); setPrompts(p || []); setRevenue(r || []);
    setLoading(false);
  }

  if (permsLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!isAdmin) return <p style={{ color: theme.gray }}>Admin access required.</p>;

  const totals = rows.reduce(
    (a, r) => ({
      scan: a.scan + Number(r.scan_cash), mat: a.mat + Number(r.material_cash),
      fnb: a.fnb + Number(r.fnb_cash), all: a.all + Number(r.total_cash),
    }),
    { scan: 0, mat: 0, fnb: 0, all: 0 }
  );
  const red = rows.filter((r) => r.status === "red");
  const yellow = rows.filter((r) => r.status === "yellow");

  const byBrand = {};
  revenue.forEach((r) => {
    byBrand[r.brand] = byBrand[r.brand] || {};
    byBrand[r.brand][r.payment_method] = (byBrand[r.brand][r.payment_method] || 0) + Number(r.amount);
  });

  return (
    <div>
      <p style={{ fontSize: 12, color: theme.gray, margin: "0 0 4px" }}>Cash Management</p>
      <h1 style={{ color: theme.navy, margin: "0 0 4px" }}>Cash Custody Monitor</h1>
      <p style={{ color: theme.gray, margin: "0 0 20px" }}>
        Who is holding cash across all three businesses right now, against their limit.
      </p>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <Stat label="Total In Staff Hands" value={`${formatMoney(totals.all)} EGP`} tone={theme.navy} />
        <Stat label="Scan Center" value={`${formatMoney(totals.scan)} EGP`} tone={theme.navy} />
        <Stat label="Dental Supply" value={`${formatMoney(totals.mat)} EGP`} tone={theme.navy} />
        <Stat label="El3awama F&B" value={`${formatMoney(totals.fnb)} EGP`} tone={theme.navy} />
        <Stat label="Over Limit" value={red.length} tone={red.length ? "#ba1a1a" : theme.navy} />
        <Stat label="Near Limit" value={yellow.length} tone={yellow.length ? "#8a6d00" : theme.navy} />
      </div>

      {red.length > 0 && (
        <div style={{ background: "#fff5f5", border: "1px solid #f0c9c9", borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, color: "#ba1a1a", marginBottom: 4 }}>
            {red.length === 1 ? "1 person is" : `${red.length} people are`} over their cash limit
          </div>
          <div style={{ fontSize: 13, color: "#7a3b3b" }}>
            {red.map((r) => `${r.name} — ${formatMoney(r.total_cash)} EGP against a ${formatMoney(r.threshold)} limit`).join(" · ")}
          </div>
          <div style={{ fontSize: 12, color: "#8a5a5a", marginTop: 6 }}>
            Nobody is blocked from taking payments. This is a prompt to move the cash to a safe.
          </div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 16, padding: 22, marginBottom: 18, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Staff Custody</h3>
        {loading ? <p style={{ color: theme.gray }}>Loading...</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: "left", color: theme.gray, fontSize: 11, textTransform: "uppercase" }}>
                  <th style={th}>Employee</th><th style={thR}>Scan</th><th style={thR}>Dental</th>
                  <th style={thR}>El3awama</th><th style={thR}>Total</th><th style={thR}>Limit</th>
                  <th style={thR}>Used</th><th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = STATUS[r.status] || STATUS.unset;
                  return (
                    <tr key={r.employee_id} style={{ borderTop: "1px solid #eceff1" }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: theme.navy }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: theme.gray }}>
                          {r.role}{r.is_cash_keeper ? " · cash keeper" : ""}
                        </div>
                      </td>
                      <td style={tdR}>{formatMoney(r.scan_cash)}</td>
                      <td style={tdR}>{formatMoney(r.material_cash)}</td>
                      <td style={tdR}>{formatMoney(r.fnb_cash)}</td>
                      <td style={{ ...tdR, fontWeight: 800, color: theme.navy }}>{formatMoney(r.total_cash)}</td>
                      <td style={tdR}>{formatMoney(r.threshold)}</td>
                      <td style={{ ...tdR, color: s.text, fontWeight: 700 }}>
                        {r.percent_of_threshold == null ? "-" : `${r.percent_of_threshold}%`}
                      </td>
                      <td style={td}>
                        <span style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: s.bg, border: `1px solid ${s.border}`, color: s.text }}>
                          {s.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: `2px solid ${theme.navy}`, background: "#f7f9fa" }}>
                  <td style={{ ...td, fontWeight: 800, color: theme.navy }}>System Total</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{formatMoney(totals.scan)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{formatMoney(totals.mat)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{formatMoney(totals.fnb)}</td>
                  <td style={{ ...tdR, fontWeight: 800, color: theme.navy }}>{formatMoney(totals.all)}</td>
                  <td style={tdR} /><td style={tdR} /><td style={td} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {prompts.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 22, marginBottom: 18, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Suggested Handovers</h3>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: -6 }}>
            Staff holding cash for a business they are not the cash keeper for.
          </p>
          <div style={{ display: "grid", gap: 6 }}>
            {prompts.map((p, i) => (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "#fafbfc", border: "1px solid #eceff1", fontSize: 13 }}>
                <strong style={{ color: theme.navy }}>{p.holder_name}</strong> holds{" "}
                {formatMoney(p.balance)} EGP{" "}
                {p.suggested_keeper_name
                  ? <>— hand to <strong style={{ color: theme.navy }}>{p.suggested_keeper_name}</strong>, on shift today.</>
                  : <span style={{ color: theme.gray }}>— no cash keeper for that business is on shift today, so it stays with them.</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Revenue by Channel · last 30 days</h3>
        {Object.keys(byBrand).length === 0 ? (
          <p style={{ color: theme.gray, fontSize: 13 }}>Nothing recorded in the last 30 days.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {Object.entries(byBrand).map(([b, methods]) => (
              <div key={b} style={{ padding: 12, borderRadius: 8, background: "#fafbfc", border: "1px solid #eceff1" }}>
                <div style={{ fontWeight: 700, color: theme.navy, marginBottom: 4 }}>
                  {b === "scan" ? "Scan Center" : b === "dental_stock" ? "Dental Supply" : "El3awama F&B"}
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
                  {Object.entries(methods).map(([m, amt]) => (
                    <span key={m} style={{ color: theme.gray }}>
                      {m}: <strong style={{ color: theme.navy }}>{formatMoney(amt)}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", minWidth: 150, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <div style={{ fontSize: 11, color: theme.gray, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: tone }}>{value}</div>
    </div>
  );
}

const th = { padding: "8px 10px", fontWeight: 700 };
const thR = { ...th, textAlign: "right" };
const td = { padding: "10px" };
const tdR = { ...td, textAlign: "right" };
