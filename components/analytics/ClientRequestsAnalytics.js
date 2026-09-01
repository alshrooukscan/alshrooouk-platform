"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";
import DrillDownModal from "./DrillDownModal";
import PeriodFilterBar, { getDateRange } from "./PeriodFilterBar";

// Oversight layer for report requests: how many are open, who they came from,
// which ones are late, and how long they actually take to turn around.
//
// "Client" requests are the ones an external partner submitted through their
// own portal; "internal" ones are raised automatically when a scan needs a
// written report. Both are shown, because an admin chasing outstanding work
// cares about the backlog as a whole, with the source as a filter on top.
export default function ClientRequestsAnalytics() {
  const [reports, setReports] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState({ year: "", quarter: "", month: "" });
  const [sourceFilter, setSourceFilter] = useState("all");
  const [drill, setDrill] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: c }] = await Promise.all([
      supabase
        .from("reports")
        .select("id, source_type, client_id, scan_name, date_required, status, assigned_to_name, created_at, completed_at, report_file_name, client_uploaded_file_name")
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name, is_pseudo"),
    ]);
    setReports(r || []);
    setClients(c || []);
    setLoading(false);
  }

  if (loading) return <p style={{ color: theme.gray }}>Loading...</p>;

  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));
  const years = [...new Set(reports.filter((r) => r.created_at).map((r) => r.created_at.slice(0, 4)))].sort().reverse();
  const { start, end } = getDateRange(dateFilter);

  let scoped = reports;
  if (start) scoped = scoped.filter((r) => r.created_at && r.created_at.slice(0, 10) >= start && r.created_at.slice(0, 10) <= end);
  if (sourceFilter !== "all") scoped = scoped.filter((r) => (r.source_type || "internal") === sourceFilter);

  const isDone = (r) => r.status === "completed" || !!r.completed_at;
  const open = scoped.filter((r) => !isDone(r));
  const done = scoped.filter((r) => isDone(r));

  // Overdue is measured against date_required, the date the requester was told
  // to expect it - not against how long it's been sitting in the queue.
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((r) => r.date_required && r.date_required < today);
  const unassigned = open.filter((r) => !r.assigned_to_name);

  const turnarounds = done
    .filter((r) => r.created_at && r.completed_at)
    .map((r) => (new Date(r.completed_at) - new Date(r.created_at)) / 86400000);
  const avgTurnaround = turnarounds.length
    ? (turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length).toFixed(1)
    : null;

  const byRequester = {};
  for (const r of scoped) {
    const label =
      (r.source_type || "internal") === "client"
        ? clientById[r.client_id]?.name || "Unknown client"
        : "Internal (from scans)";
    const b = (byRequester[label] = byRequester[label] || { total: 0, open: 0, overdue: 0 });
    b.total++;
    if (!isDone(r)) b.open++;
    if (!isDone(r) && r.date_required && r.date_required < today) b.overdue++;
  }
  const requesterRows = Object.entries(byRequester).sort((a, b) => b[1].total - a[1].total);

  const byScan = {};
  for (const r of scoped) {
    const k = (r.scan_name || "Unspecified").trim() || "Unspecified";
    byScan[k] = (byScan[k] || 0) + 1;
  }
  const topScans = Object.entries(byScan).sort((a, b) => b[1] - a[1]).slice(0, 8);

  function openDrill(title, rows) {
    setDrill({
      title,
      subtitle: `${rows.length} request${rows.length === 1 ? "" : "s"}`,
      columns: [
        { key: "requester", label: "From" },
        { key: "scan", label: "Scan / Report" },
        { key: "required", label: "Due" },
        { key: "status", label: "Status" },
        { key: "assigned", label: "Assigned To" },
      ],
      rows: rows.map((r) => ({
        requester:
          (r.source_type || "internal") === "client"
            ? clientById[r.client_id]?.name || "Unknown client"
            : "Internal",
        scan: r.scan_name || "-",
        required: r.date_required || "-",
        status: isDone(r) ? "Completed" : r.date_required && r.date_required < today ? "Overdue" : "Pending",
        assigned: r.assigned_to_name || "Unassigned",
      })),
    });
  }

  const cards = [
    { label: "Open Requests", value: open.length, rows: open, color: theme.navy },
    { label: "Overdue", value: overdue.length, rows: overdue, color: overdue.length ? "#ba1a1a" : theme.navy },
    { label: "Unassigned", value: unassigned.length, rows: unassigned, color: unassigned.length ? "#a97c00" : theme.navy },
    { label: "Completed", value: done.length, rows: done, color: "#1e7a3c" },
  ];

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Client Requests</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        Every report request in the system, where it came from, and what is overdue.
      </p>

      <PeriodFilterBar years={years} year={dateFilter.year} quarter={dateFilter.quarter} month={dateFilter.month} day={dateFilter.day} onChange={setDateFilter} />

      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[
          { key: "all", label: "All Sources" },
          { key: "client", label: "From Clients" },
          { key: "internal", label: "Internal" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setSourceFilter(f.key)}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: sourceFilter === f.key ? theme.navy : "#fff",
              color: sourceFilter === f.key ? "#fff" : theme.navy,
              fontWeight: 700, cursor: "pointer", fontSize: 13, boxShadow: "0 2px 8px rgba(39,33,77,0.06)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => openDrill(c.label, c.rows)}
            style={{ background: "#fff", borderRadius: 16, padding: 20, border: "none", textAlign: "left", cursor: "pointer", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}
          >
            <div style={{ fontSize: 11, color: theme.gray, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: c.color }}>{c.value}</div>
          </button>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
        <h3 style={{ color: theme.navy, marginTop: 0 }}>Average Turnaround</h3>
        {avgTurnaround === null ? (
          <p style={{ color: theme.gray, fontSize: 13, margin: 0 }}>
            No completed requests with both a start and finish time yet, so there is nothing to average.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: theme.navy }}>{avgTurnaround}</span>
            <span style={{ fontSize: 13, color: theme.gray, marginLeft: 8 }}>
              days from request to completed report, across {turnarounds.length} finished request{turnarounds.length === 1 ? "" : "s"}
            </span>
          </p>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Requests by Requester</h3>
          {requesterRows.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>No requests in this period.</p>}
          {requesterRows.map(([name, b]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ color: theme.navy, fontWeight: 600, fontSize: 13 }}>{name}</span>
              <span style={{ fontSize: 12, color: theme.gray, whiteSpace: "nowrap" }}>
                {b.total} total &middot; {b.open} open
                {b.overdue > 0 && <span style={{ color: "#ba1a1a", fontWeight: 700 }}> &middot; {b.overdue} overdue</span>}
              </span>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Most Requested Reports</h3>
          {topScans.length === 0 && <p style={{ color: theme.gray, fontSize: 13 }}>Nothing recorded in this period.</p>}
          {topScans.map(([name, count]) => (
            <div key={name} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: theme.navy, fontWeight: 600 }}>{name}</span>
                <span style={{ color: theme.gray, marginLeft: 8 }}>{count}</span>
              </div>
              <div style={{ height: 8, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(count / topScans[0][1]) * 100}%`, background: theme.gold, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {drill && (
        <DrillDownModal title={drill.title} subtitle={drill.subtitle} columns={drill.columns} rows={drill.rows} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}
