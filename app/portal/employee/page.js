"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";
import { formatMoney } from "../../../lib/format";
import Loading from "../../../lib/Loading";

export default function EmployeePortalPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [tab, setTab] = useState("overview");
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
      () => {
        setGeoError("Location permission is required to sign in or out.");
        setPunching(false);
      }
    );
  }

  if (loading) return <Loading />;

  const lastEvent = data.events[0];
  const nextAction = lastEvent?.event_type === "login" ? "logout" : "login";
  const annualBase = formatMoney(Number(data.employee?.fixed_salary || 0) * 12);

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

        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {[
            { key: "overview", label: "Overview" },
            { key: "payslips", label: "Payslips" },
            { key: "vacations", label: "Vacations" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 8,
                border: `1px solid ${tab === t.key ? theme.gold : "#ddd"}`,
                background: tab === t.key ? theme.goldLight : "#fff",
                color: theme.navy,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <>
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
                {punching ? "Getting location..." : nextAction === "login" ? "Sign In" : "Sign Out"}
              </button>
              {geoError && <p style={{ color: "#ba1a1a", fontSize: 12, marginTop: 10 }}>{geoError}</p>}
              <p style={{ fontSize: 10, color: "#bbb", marginTop: 10 }}>Your location and IP address are recorded with each sign in/out for attendance tracking.</p>
            </div>

            <div style={cardStyle}>
              <h3 style={{ color: theme.navy, marginTop: 0, fontSize: 15 }}>Salary Overview</h3>
              <Row label="Fixed Salary (monthly)" value={`${formatMoney(data.employee?.fixed_salary, { decimals: 2 })} EGP`} />
              <Row label="Variable Salary (monthly)" value={`${formatMoney(data.employee?.variable_salary, { decimals: 2 })} EGP`} />
              <Row label="Annual Base (fixed x 12)" value={`${annualBase} EGP`} bold />
            </div>

            <h3 style={{ color: theme.navy, marginTop: 20, marginBottom: 10, fontSize: 15 }}>Recent Activity</h3>
            {data.events.length === 0 && <div style={cardStyle}>No sign in/out activity yet.</div>}
            {data.events.map((e) => (
              <div key={e.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, color: theme.navy, textTransform: "capitalize" }}>{e.event_type}</span>
                  <span style={{ fontSize: 12, color: theme.gray }}>{new Date(e.event_time).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 11, color: theme.gray, marginTop: 4 }}>
                  {e.lat && `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}`} {e.ip_address && `· IP ${e.ip_address}`}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "payslips" && (
          <>
            {data.payslips.length === 0 && <div style={cardStyle}>No payslips generated yet.</div>}
            {data.payslips.map((p) => (
              <div key={p.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, color: theme.navy }}>{p.period}</span>
                  <span style={{ fontWeight: 700, color: theme.navy }}>{formatMoney(p.net_total, { decimals: 2 })} EGP</span>
                </div>
                {(p.deductions || []).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {p.deductions.map((d, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#ba1a1a" }}>- {d.name}: {formatMoney(d.amount, { decimals: 2 })} EGP</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "vacations" && <VacationsTab leaveRequests={data.leaveRequests} onSubmitted={load} />}
      </div>
    </div>
  );
}

function VacationsTab({ leaveRequests, onSubmitted }) {
  const [showForm, setShowForm] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!startDate || !endDate) {
      setError("Start and end dates are required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/portal/employee/leave-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, reason }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not submit request.");
      return;
    }
    setShowForm(false);
    setStartDate("");
    setEndDate("");
    setReason("");
    onSubmitted();
  }

  const statusColor = { pending: "#a97c00", approved: "#2e7d32", rejected: "#ba1a1a" };
  const statusBg = { pending: "#fff8e1", approved: "#e8f5e9", rejected: "#fdecea" };

  return (
    <div>
      {!showForm && (
        <button onClick={() => setShowForm(true)} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>
          + Request Vacation
        </button>
      )}
      {showForm && (
        <div style={cardStyle}>
          <label style={labelStyle}>Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
          <label style={labelStyle}>End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
          <label style={labelStyle}>Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={inp} placeholder="e.g., Family trip" />
          {error && <p style={{ color: "#ba1a1a", fontSize: 12 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSubmit} disabled={saving} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      )}

      {leaveRequests.length === 0 && !showForm && <div style={cardStyle}>No vacation requests yet.</div>}
      {leaveRequests.map((r) => (
        <div key={r.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: theme.navy, fontWeight: 600 }}>{r.start_date} &rarr; {r.end_date}</span>
            <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 999, background: statusBg[r.status], color: statusColor[r.status], fontWeight: 700, textTransform: "capitalize" }}>{r.status}</span>
          </div>
          {r.reason && <div style={{ fontSize: 12, color: theme.gray, marginTop: 4 }}>{r.reason}</div>}
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
      <span style={{ color: theme.gray }}>{label}</span>
      <span style={{ color: theme.navy, fontWeight: bold ? 700 : 600 }}>{value}</span>
    </div>
  );
}

const cardStyle = { background: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, boxShadow: "0 2px 10px rgba(39,33,77,0.05)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "#27214D", display: "block", marginBottom: 6 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 14 };
