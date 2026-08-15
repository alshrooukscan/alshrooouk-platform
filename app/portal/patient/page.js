"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";

export default function PatientPortalPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/portal/patient/data")
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => router.replace("/portal/login"));
  }, [router]);

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/portal/login");
  }

  if (loading) return <Centered>Loading...</Centered>;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <TopBar onLogout={handleLogout} />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 4 }}>Hi {data.patient?.name?.split(" ")[0]},</h2>
        <p style={{ color: theme.gray, marginBottom: 20 }}>Here's the status of your scans and results.</p>

        {data.visits.length === 0 && <EmptyCard>No visits on record yet.</EmptyCard>}
        {data.visits.map((v) => (
          <div key={v.id} style={cardStyle}>
            <div style={{ fontWeight: 700, color: theme.navy }}>{(v.scan_types || []).join(", ")}</div>
            <div style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>{v.exam_date} &middot; {v.branches?.name}</div>
            <span
              style={{
                display: "inline-block",
                marginTop: 8,
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 11,
                background: v.payment_status === "paid" ? "#e8f5e9" : "#fff8e1",
                color: v.payment_status === "paid" ? "#2e7d32" : "#a97c00",
              }}
            >
              {v.payment_status}
            </span>
          </div>
        ))}

        <h3 style={{ color: theme.navy, marginTop: 28, marginBottom: 12 }}>Your Files</h3>
        {data.files.length === 0 && <EmptyCard>No files uploaded yet. They'll appear here once your scan is processed.</EmptyCard>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {data.files.map((f) => (
            <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer" style={{ ...cardStyle, textDecoration: "none", display: "block" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>{new Date(f.createdTime).toLocaleDateString()}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function TopBar({ onLogout }) {
  return (
    <div style={{ background: theme.navy, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "#fff", fontWeight: 700 }}>Al Shrooouk Scan &amp; Lab</span>
      <button onClick={onLogout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
        Log Out
      </button>
    </div>
  );
}
function Centered({ children }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: theme.gray }}>{children}</div>;
}
function EmptyCard({ children }) {
  return <div style={{ ...cardStyle, color: theme.gray, fontSize: 13 }}>{children}</div>;
}
const cardStyle = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 10, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" };
