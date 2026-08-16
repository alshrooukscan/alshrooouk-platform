"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import Loading from "../../../lib/Loading";

export default function EmployeePortalPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [geoError, setGeoError] = useState("");
  const router = useRouter();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const r = await fetch("/api/portal/employee/data");
    if (!r.ok) {
      router.replace("/portal/login");
      return;
    }
    setData(await r.json());
    setLoading(false);
  }

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/portal/login");
  }

  function handlePunch(eventType) {
    setGeoError("");
    if (!navigator.geolocation) {
      setGeoError("Geolocation isn't available on this device.");
      return;
    }
    setPunching(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await fetch("/api/portal/employee/clock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType, lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
        setPunching(false);
        load();
      },
      (err) => {
        setGeoError("Location permission is required to clock in or out.");
        setPunching(false);
      }
    );
  }

  if (loading) return <Loading />;

  const lastEvent = data.events[0];
  const nextAction = lastEvent?.event_type === "login" ? "logout" : "login";

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

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
        <h2 style={{ color: theme.navy, marginBottom: 2 }}>{data.employee?.name}</h2>
        <p style={{ color: theme.gray, marginBottom: 20 }}>{data.employee?.role} &middot; {data.employee?.hr_id}</p>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 20, textAlign: "center", boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
          <p style={{ fontSize: 13, color: theme.gray, marginBottom: 12 }}>
            {lastEvent ? `Last: ${lastEvent.event_type} at ${new Date(lastEvent.event_time).toLocaleTimeString()}` : "No activity yet today"}
          </p>
          <button
            onClick={() => handlePunch(nextAction)}
            disabled={punching}
            style={{
              padding: "14px 32px",
              borderRadius: 999,
              border: "none",
              background: nextAction === "login" ? theme.navy : "#ba1a1a",
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {punching ? "Getting location..." : nextAction === "login" ? "Clock In" : "Clock Out"}
          </button>
          {geoError && <p style={{ color: "#ba1a1a", fontSize: 12, marginTop: 10 }}>{geoError}</p>}
        </div>

        <h3 style={{ color: theme.navy, marginBottom: 10 }}>Recent Payslips</h3>
        {data.payslips.length === 0 && <div style={cardStyle}>No payslips generated yet.</div>}
        {data.payslips.map((p) => (
          <div key={p.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600, color: theme.navy }}>{p.period}</span>
              <span style={{ fontWeight: 700, color: theme.navy }}>{Number(p.net_total).toFixed(2)} EGP</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const cardStyle = { background: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" };
