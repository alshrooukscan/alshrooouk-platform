"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { theme } from "../../../lib/theme";
import { uploadFileToDrive } from "../../../lib/uploadToDrive";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";

const ERROR_TYPES = [
  { key: "application_error", label: "Application error / page crashed" },
  { key: "wrong_data", label: "Wrong data shown" },
  { key: "missing_data", label: "Something is missing that should be there" },
  { key: "permission_denied", label: "I can't access a page I should" },
  { key: "upload_problem", label: "File upload problem" },
  { key: "slow_or_stuck", label: "Slow, stuck or not responding" },
  { key: "feature_request", label: "Suggestion / something I need" },
  { key: "other", label: "Other" },
];

const STATUS_STYLE = {
  open: { bg: "#fff8e1", fg: "#a97c00", label: "Open" },
  in_progress: { bg: "#e8eefc", fg: "#27214d", label: "In progress" },
  resolved: { bg: "#e6f4ea", fg: "#1e7a3c", label: "Resolved" },
  wont_fix: { bg: "#f0f0f0", fg: "#777", label: "Won't fix" },
};

export default function BugReportsPage() {
  const [reports, setReports] = useState([]);
  useAutoRefresh(["bug_reports"], () => { load(); });
  const [canTriage, setCanTriage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [progress, setProgress] = useState(null);

  const [form, setForm] = useState({
    pageUrl: "",
    errorType: "",
    errorMessage: "",
    description: "",
  });
  const [shot, setShot] = useState(null);

  useEffect(() => {
    load();
    // Pre-fill the page they were on. Most reports come straight after hitting
    // the problem, and asking someone to retype a URL loses the one detail that
    // makes a report reproducible.
    if (typeof document !== "undefined" && document.referrer) {
      setForm((f) => ({ ...f, pageUrl: document.referrer }));
    }
  }, []);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/bug-reports", { headers: { Authorization: `Bearer ${await token()}` } });
    if (res.ok) {
      const j = await res.json();
      setReports(j.reports || []);
      setCanTriage(!!j.canTriage);
    }
    setLoading(false);
  }

  async function submit() {
    setError("");
    if (!form.errorType) return setError("Choose what kind of problem this is.");
    if (!form.description.trim()) return setError("Please describe what happened.");
    setBusy(true);
    try {
      let screenshotDriveId = null;
      let screenshotName = null;
      if (shot) {
        setProgress(0);
        screenshotDriveId = await uploadFileToDrive({
          file: shot,
          initEndpoint: "/api/bug-reports/upload-session",
          initBody: { fileName: shot.name, mimeType: shot.type, sizeBytes: shot.size },
          onProgress: (f) => setProgress(Math.round(f * 100)),
          authToken: await token(),
        });
        screenshotName = shot.name;
        setProgress(null);
      }
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ ...form, screenshotDriveId, screenshotName }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not send the report");
      setSent(true);
      setShowForm(false);
      setForm({ pageUrl: "", errorType: "", errorMessage: "", description: "" });
      setShot(null);
      load();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
    setProgress(null);
  }

  async function setStatus(id, status) {
    await fetch("/api/bug-reports", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  const shown = filter === "all" ? reports : reports.filter((r) => r.status === filter);
  const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", marginBottom: 12 };

  return (
    <div>
      <h1 style={{ color: theme.navy, marginBottom: 4 }}>Report a Problem</h1>
      <p style={{ color: theme.gray, marginBottom: 20 }}>
        {canTriage
          ? "Everything staff have reported. You are the only person who sees this full list."
          : "Tell us what went wrong and it goes straight to Moamen. You can see your own reports and their status below."}
      </p>

      {sent && (
        <div style={{ background: "#e6f4ea", border: "1px solid #b7dfc4", borderRadius: 10, padding: "12px 16px", marginBottom: 18, color: "#1e7a3c", fontSize: 13, fontWeight: 600 }}>
          Thank you — your report was sent. You can follow its status in the list below.
        </div>
      )}

      <button
        onClick={() => { setShowForm((v) => !v); setSent(false); }}
        style={{ padding: "11px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 18 }}
      >
        {showForm ? "Cancel" : "+ Report a Problem"}
      </button>

      {showForm && (
        <div style={{ background: "#fff", borderRadius: 14, padding: 22, marginBottom: 22, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          {error && <p style={{ color: "#ba1a1a", fontSize: 13, marginTop: 0 }}>{error}</p>}

          <label style={lbl}>What kind of problem is it?</label>
          <select style={inp} value={form.errorType} onChange={(e) => setForm({ ...form, errorType: e.target.value })}>
            <option value="">Choose one...</option>
            {ERROR_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>

          <label style={lbl}>Which page? (link or page name)</label>
          <input style={inp} value={form.pageUrl} placeholder="e.g. Patient page for Ahmed Ali"
            onChange={(e) => setForm({ ...form, pageUrl: e.target.value })} />

          <label style={lbl}>What happened? Please be specific.</label>
          <textarea style={{ ...inp, minHeight: 100, fontFamily: "inherit" }}
            value={form.description}
            placeholder="What were you doing, what did you expect, and what happened instead?"
            onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <label style={lbl}>Exact error message, if one appeared (optional)</label>
          <input style={inp} value={form.errorMessage} placeholder="Copy the message exactly if you can"
            onChange={(e) => setForm({ ...form, errorMessage: e.target.value })} />

          <label style={lbl}>Screenshot (optional, but it helps a lot)</label>
          <input type="file" accept="image/*" style={{ ...inp, padding: 8 }}
            onChange={(e) => setShot(e.target.files?.[0] || null)} />
          {progress !== null && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 6, background: "#eee", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress}%`, background: theme.gold }} />
              </div>
              <span style={{ fontSize: 11, color: theme.gray }}>Uploading screenshot {progress}%</span>
            </div>
          )}

          <button onClick={submit} disabled={busy}
            style={{ padding: "11px 22px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Sending..." : "Send Report"}
          </button>
        </div>
      )}

      {canTriage && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {["all", "open", "in_progress", "resolved", "wont_fix"].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: filter === f ? theme.navy : "#fff", color: filter === f ? "#fff" : theme.navy,
                boxShadow: "0 2px 8px rgba(39,33,77,0.06)" }}>
              {f === "all" ? "All" : STATUS_STYLE[f].label}
              {f !== "all" && ` (${reports.filter((r) => r.status === f).length})`}
            </button>
          ))}
        </div>
      )}

      {loading && <p style={{ color: theme.gray }}>Loading...</p>}
      {!loading && shown.length === 0 && (
        <p style={{ color: theme.gray, fontSize: 13 }}>
          {canTriage ? "Nothing reported yet." : "You haven't reported anything yet."}
        </p>
      )}

      {shown.map((r) => {
        const s = STATUS_STYLE[r.status] || STATUS_STYLE.open;
        return (
          <div key={r.id} style={{ background: "#fff", borderRadius: 12, padding: 18, marginBottom: 12, boxShadow: "0 2px 12px rgba(39,33,77,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: theme.navy, fontSize: 14 }}>
                {ERROR_TYPES.find((t) => t.key === r.error_type)?.label || r.error_type}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>
                {s.label}
              </span>
            </div>
            <div style={{ fontSize: 11, color: theme.gray, marginBottom: 8 }}>
              {r.reporter_name || "Unknown"} &middot; {new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              {r.page_url && <> &middot; {r.page_url.length > 60 ? r.page_url.slice(0, 60) + "..." : r.page_url}</>}
            </div>
            <div style={{ fontSize: 13, color: theme.navy, whiteSpace: "pre-wrap", marginBottom: 8 }}>{r.description}</div>
            {r.error_message && (
              <div style={{ fontSize: 12, fontFamily: "monospace", background: "#faf9fb", padding: "8px 10px", borderRadius: 6, color: "#ba1a1a", marginBottom: 8 }}>
                {r.error_message}
              </div>
            )}
            {r.screenshot_drive_id && (
              <a href={`https://drive.google.com/file/d/${r.screenshot_drive_id}/view`} target="_blank" rel="noreferrer"
                style={{ fontSize: 12, fontWeight: 700, color: theme.gold, textDecoration: "none" }}>
                View screenshot &rarr;
              </a>
            )}
            {canTriage && (
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {["open", "in_progress", "resolved", "wont_fix"].map((st) => (
                  <button key={st} onClick={() => setStatus(r.id, st)} disabled={r.status === st}
                    style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #ddd",
                      background: r.status === st ? theme.navy : "#fff", color: r.status === st ? "#fff" : theme.navy,
                      fontSize: 11, fontWeight: 700, cursor: r.status === st ? "default" : "pointer" }}>
                    {STATUS_STYLE[st].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: "#48464E", marginBottom: 5 };
