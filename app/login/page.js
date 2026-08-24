"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

// The one and only login page. Staff (Supabase Auth), and patients/doctors/
// employees (the custom portal username/password system) are two genuinely
// different backends, but everyone should only ever see ONE login link and
// ONE form - this tries staff auth first, and falls back to the portal
// system if that doesn't match, routing to the right place either way.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: staffError } = await supabase.auth.signInWithPassword({ email, password });
    if (!staffError) {
      setLoading(false);
      router.push("/dashboard");
      return;
    }

    const res = await fetch("/api/portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError("Invalid username or password");
      return;
    }
    router.push(`/portal/${data.role}`);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: theme.navyDark,
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 40,
          width: 360,
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img src="/logo-full.png" alt="Al Shrooouk Scan & Lab" style={{ height: 90, width: "auto", margin: "0 auto 8px" }} />
          <h1 style={{ fontSize: 20, color: theme.navy, margin: "8px 0 4px" }}>Log In</h1>
          <p style={{ fontSize: 12, color: theme.gray, marginTop: 2 }}>Staff, patients, doctors, and employees all log in here.</p>
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>Email or Username</label>
        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          style={inputStyle}
        />

        <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>Password</label>
        <div style={{ position: "relative" }}>
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ ...inputStyle, paddingRight: 40 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            style={{ position: "absolute", right: 10, top: 8, background: "none", border: "none", cursor: "pointer", padding: 4, color: theme.gray }}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "12px 0",
            borderRadius: 8,
            border: "none",
            background: theme.navy,
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {loading ? "Logging in..." : "Log In"}
        </button>
      </form>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a20.44 20.44 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

const inputStyle = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  marginTop: 6,
  marginBottom: 16,
  borderRadius: 8,
  border: "1px solid #ddd",
  fontSize: 14,
  boxSizing: "border-box",
};
