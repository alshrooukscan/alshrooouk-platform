"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import { formatVisitDate } from "../../../lib/format";
import ImpersonationBanner from "../../../components/ImpersonationBanner";
import Loading from "../../../lib/Loading";

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
        if (d.mustChangePassword) {
          router.replace("/portal/change-password");
          return;
        }
        setData(d);
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/login");
  }

  if (loading) return <Loading />;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg }}>
      <ImpersonationBanner impersonatedBy={data.impersonatedBy} name={data.patient?.name} />
      <TopBar onLogout={handleLogout} />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 4 }}>Hi {data.patient?.name?.split(" ")[0]},</h2>
        <p style={{ color: theme.gray, marginBottom: 20 }}>Here's the status of your scans and results.</p>

        {data.visits.length === 0 && <EmptyCard>No visits on record yet.</EmptyCard>}
        {data.visits.map((v) => (
          <div key={v.id} style={cardStyle}>
            <div style={{ fontWeight: 700, color: theme.navy }}>{(v.scan_types || []).join(", ")}</div>
            <div style={{ fontSize: 12, color: theme.navy, marginTop: 2, fontWeight: 600 }}>{formatVisitDate(v.exam_date)}<span style={{ color: theme.gray, fontWeight: 400 }}> &middot; {v.branches?.name}</span></div>
            <div style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>Referred by: {v.doctors?.name || "Walk-in, no referring doctor"}</div>
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

            {v.files && v.files.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0", display: "grid", gap: 6 }}>
                {v.files.map((f) => (
                  <a
                    key={f.id}
                    href={f.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "#faf9fb", textDecoration: "none" }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    {!f.exact && (
                      <span style={{ fontSize: 9, color: theme.gray, fontStyle: "italic", whiteSpace: "nowrap", marginLeft: 8 }}>possibly related</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}

        {data.files.length > 0 && (
          <>
            <h3 style={{ color: theme.navy, marginTop: 28, marginBottom: 12 }}>Other Files</h3>
            <p style={{ fontSize: 12, color: theme.gray, marginTop: -8, marginBottom: 12 }}>Couldn't be matched to a specific scan above.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {data.files.map((f) => (
                <a key={f.id} href={f.webViewLink} target="_blank" rel="noreferrer" style={{ ...cardStyle, textDecoration: "none", display: "block" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>{new Date(f.createdTime).toLocaleDateString()}</div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TopBar({ onLogout }) {
  return (
    <div style={{ background: theme.navy, padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src="/logo-mark.png" alt="" style={{ height: 32, width: "auto" }} />
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Al Shrooouk Scan &amp; Lab</span>
      </div>
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
