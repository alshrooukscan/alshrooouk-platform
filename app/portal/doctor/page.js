"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import Loading from "../../../lib/Loading";

export default function DoctorPortalPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/portal/doctor/data")
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
        <h2 style={{ color: theme.navy, marginBottom: 2 }}>{data.doctor?.name}</h2>
        <p style={{ color: theme.gold, fontWeight: 600, marginBottom: 20 }}>{data.doctor?.clinic_code} &middot; {data.doctor?.clinic_name}</p>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <h3 style={{ color: theme.navy, marginTop: 0 }}>Your Referrals</h3>
          {data.visits.length === 0 && <p style={{ color: theme.gray, fontSize: 14 }}>No referrals yet.</p>}
          {data.visits.map((v) => (
            <div key={v.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0", display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600, color: theme.navy }}>{v.patients?.name}</div>
                <div style={{ fontSize: 12, color: theme.gray }}>{(v.scan_types || []).join(", ")}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: theme.gray }}>
                <div>{v.exam_date}</div>
                <div>{v.payment_status}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
