"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: theme.navyDark,
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
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              margin: "0 auto 12px",
              background: `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})`,
            }}
          />
          <h1 style={{ fontSize: 20, color: theme.navy, margin: 0 }}>Staff Portal</h1>
          <p style={{ fontSize: 13, color: theme.gray, marginTop: 4 }}>Al Shrooouk Scan &amp; Lab</p>
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>Email or Username</label>
        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />

        <label style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />

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
