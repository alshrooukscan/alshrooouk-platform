"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";

export default function PortalLoginPage() {
  const [role, setRole] = useState("patient");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, username, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Login failed");
      return;
    }
    router.push(`/portal/${role}`);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: theme.navyDark, padding: 16 }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 16, padding: 36, width: 360, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", margin: "0 auto 10px", background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})` }} />
          <h1 style={{ fontSize: 19, color: theme.navy, margin: 0 }}>Al Shrooouk Scan &amp; Lab</h1>
          <p style={{ fontSize: 13, color: theme.gray, marginTop: 4 }}>View your results, referrals, or payslips</p>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {["patient", "doctor", "employee"].map((r) => (
            <button
              type="button"
              key={r}
              onClick={() => setRole(r)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 8,
                border: `1px solid ${role === r ? theme.gold : "#ddd"}`,
                background: role === r ? theme.goldLight : "#fff",
                color: theme.navy,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} required style={inp} />

        <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={inp} />

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

        <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 8, padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
          {loading ? "Logging in..." : "Log In"}
        </button>
      </form>
    </div>
  );
}

const inp = { display: "block", width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 14, borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
