"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { usePermissions } from "../../../lib/usePermissions";

const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" };
const inp = { padding: "9px 11px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 };

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function ExportsPage() {
  const { isAdmin, loading: permLoading } = usePermissions();
  const [reports, setReports] = useState([]);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function load() {
    const res = await fetch("/api/exports", { headers: { Authorization: `Bearer ${await token()}` } });
    if (res.ok) setReports((await res.json()).reports);
  }

  function params(r) {
    const p = new URLSearchParams({ report: r.key });
    if (r.dated) { p.set("from", from); p.set("to", to); }
    return p;
  }

  async function doPreview(r) {
    setBusy(r.key + ":preview");
    setError("");
    setPreview(null);
    const p = params(r);
    p.set("preview", "1");
    const res = await fetch(`/api/exports?${p}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const j = await res.json();
    setBusy("");
    if (!res.ok) return setError(j.error);
    setPreview({ report: r, ...j });
  }

  async function download(r, format) {
    setBusy(r.key + ":" + format);
    setError("");
    const p = params(r);
    p.set("format", format);
    // Fetched rather than opened in a tab so the auth header travels with it,
    // and so an empty report surfaces as a message instead of a broken download.
    const res = await fetch(`/api/exports?${p}`, { headers: { Authorization: `Bearer ${await token()}` } });
    setBusy("");
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error || "That export failed.");
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const name = (cd.match(/filename="(.+?)"/) || [])[1] || `${r.key}.${format}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (permLoading) return <p style={{ color: theme.gray }}>Loading...</p>;
  if (!isAdmin) {
    return (
      <div style={card}>
        <h2 style={{ color: theme.navy, marginTop: 0 }}>Exports are admin only</h2>
        <p style={{ color: theme.gray, fontSize: 14 }}>
          These reports contain salaries, full financial history and patient contact details, so access is limited to
          admins.
        </p>
      </div>
    );
  }

  const groups = [...new Set(reports.map((r) => r.group))];

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Export Centre</h1>
      <p style={{ color: theme.gray, marginBottom: 18 }}>
        Excel keeps numbers as numbers and carries an About sheet recording who pulled the file and when. CSV is there
        for anything that needs importing elsewhere.
      </p>

      <div style={{ ...card, marginBottom: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.navy }}>Period</span>
        <input type="date" style={inp} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: theme.gray }}>to</span>
        <input type="date" style={inp} value={to} onChange={(e) => setTo(e.target.value)} />
        {[
          ["This month", firstOfMonth(), new Date().toISOString().slice(0, 10)],
          ["This year", `${new Date().getFullYear()}-01-01`, new Date().toISOString().slice(0, 10)],
          ["All time", "2000-01-01", new Date().toISOString().slice(0, 10)],
        ].map(([label, f, t]) => (
          <button key={label} onClick={() => { setFrom(f); setTo(t); }}
            style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: theme.gray }}>Applies only to reports marked with a period.</span>
      </div>

      {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

      {preview && (
        <div style={{ ...card, marginBottom: 18, borderLeft: `4px solid ${theme.gold}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ color: theme.navy, margin: 0 }}>
              {preview.report.label} — {preview.count.toLocaleString()} row{preview.count === 1 ? "" : "s"}
            </h3>
            <button onClick={() => setPreview(null)} style={{ border: "none", background: "none", color: theme.gray, cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
          {preview.count === 0 ? (
            <p style={{ fontSize: 13, color: theme.gray }}>Nothing matches that period.</p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                <thead>
                  <tr>{preview.columns.map((c) => (
                    <th key={c} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "2px solid #eee", color: theme.navy, whiteSpace: "nowrap" }}>{c}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, i) => (
                    <tr key={i}>{preview.columns.map((c) => (
                      <td key={c} style={{ padding: "5px 10px", borderBottom: "1px solid #f5f5f5", color: "#444", whiteSpace: "nowrap" }}>{String(row[c] ?? "")}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
              {preview.count > preview.sample.length && (
                <p style={{ fontSize: 11, color: theme.gray, marginTop: 8 }}>
                  Showing the first {preview.sample.length}. The file has all {preview.count.toLocaleString()}.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 22 }}>
          <h3 style={{ color: theme.navy, fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>{g}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
            {reports.filter((r) => r.group === g).map((r) => (
              <div key={r.key} style={card}>
                <div style={{ fontSize: 14, fontWeight: 700, color: theme.navy }}>
                  {r.label}
                  {r.dated && <span style={{ fontSize: 10, fontWeight: 700, color: "#a97c00", background: "#fff8e1", padding: "2px 7px", borderRadius: 999, marginLeft: 8 }}>PERIOD</span>}
                </div>
                <p style={{ fontSize: 12, color: theme.gray, margin: "6px 0 12px", minHeight: 32 }}>{r.description}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => doPreview(r)} disabled={busy.startsWith(r.key)}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {busy === r.key + ":preview" ? "..." : "Preview"}
                  </button>
                  <button onClick={() => download(r, "xlsx")} disabled={busy.startsWith(r.key)}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {busy === r.key + ":xlsx" ? "..." : "Excel"}
                  </button>
                  <button onClick={() => download(r, "csv")} disabled={busy.startsWith(r.key)}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {busy === r.key + ":csv" ? "..." : "CSV"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
