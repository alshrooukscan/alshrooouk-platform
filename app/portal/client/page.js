"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import Loading from "../../../lib/Loading";

export default function ClientPortalPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [scanName, setScanName] = useState("");
  const [dateRequired, setDateRequired] = useState("");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    load();
  }, []);

  function load() {
    fetch("/api/portal/client/data")
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((d) => {
        if (d.mustChangePassword) {
          router.replace("/portal/change-password");
          return;
        }
        setData(d);
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/login");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!scanName.trim() || !file) {
      setError("Enter what this is for and attach a file.");
      return;
    }
    setSubmitting(true);
    setError("");
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      const res = await fetch("/api/portal/client/submit-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanName: scanName.trim(), dateRequired: dateRequired || undefined, fileName: file.name, mimeType: file.type, base64 }),
      });
      const result = await res.json();
      setSubmitting(false);
      if (!res.ok) {
        setError(result.error || "Something went wrong submitting this request.");
        return;
      }
      setScanName("");
      setDateRequired("");
      setFile(null);
      setShowForm(false);
      load();
    };
    reader.readAsDataURL(file);
  }

  if (loading) return <Loading />;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <div style={{ background: theme.navy, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/logo-mark.png" alt="" style={{ height: 32, width: "auto" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Al Shrooouk Scan &amp; Lab</span>
        </div>
        <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          Log Out
        </button>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 20 }}>{data.client?.name}</h2>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showForm ? 16 : 0 }}>
            <h3 style={{ color: theme.navy, margin: 0 }}>Submit a Request</h3>
            <button
              onClick={() => setShowForm((v) => !v)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: theme.gold, color: theme.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
            >
              {showForm ? "Cancel" : "+ New Request"}
            </button>
          </div>
          {showForm && (
            <form onSubmit={handleSubmit}>
              <label style={lbl}>What is this for?</label>
              <input style={inp} value={scanName} onChange={(e) => setScanName(e.target.value)} placeholder="e.g. CBCT report for patient X" />
              <label style={lbl}>Date Needed (optional)</label>
              <input type="date" style={inp} value={dateRequired} onChange={(e) => setDateRequired(e.target.value)} />
              <label style={lbl}>Attach File</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ marginBottom: 10 }} />
              {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
              <button type="submit" disabled={submitting} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </form>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Your Requests</h3>
          {data.reports.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No requests yet.</p>}
          {data.reports.map((r) => (
            <div key={r.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, color: theme.navy, fontSize: 14 }}>{r.scan_name}</div>
                  <div style={{ fontSize: 12, color: theme.gray }}>Needed by {r.date_required}</div>
                </div>
                <span
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                    background: r.status === "completed" ? "#e7f6ec" : "#fff8e1",
                    color: r.status === "completed" ? "#1e7a3c" : "#8a6d00",
                  }}
                >
                  {r.status === "completed" ? "Done" : "Pending"}
                </span>
              </div>
              {r.report_file_url && (
                <a href={r.report_file_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: theme.gold, fontWeight: 600 }}>
                  Download: {r.report_file_name}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 11, color: "#48464E", fontWeight: 600, marginBottom: 4, marginTop: 10 };
const inp = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", marginBottom: 4 };
