"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../lib/theme";

// Shown once, right after login, whenever the account's must_change_password
// flag is still set - which is every account today (Phase 7 #1), since it
// applies retroactively to everyone who already had staff-generated
// credentials, not just new ones going forward.
export default function ChangePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function isStrongEnough(pwd) {
    return pwd.length >= 8 && /\d/.test(pwd);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!isStrongEnough(password)) {
      setError("Password must be at least 8 characters and include a number.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/portal/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: password }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong. Please try again.");
      return;
    }
    router.replace(`/portal/${data.role}`);
  }

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, maxWidth: 400, width: "100%", boxShadow: "0 4px 20px rgba(39,33,77,0.08)" }}>
        <h2 style={{ color: theme.navy, marginTop: 0 }}>Set Your Own Password</h2>
        <p style={{ color: theme.gray, fontSize: 13, marginBottom: 20 }}>
          For your security, please choose a new password before continuing. At least 8 characters, including a number.
        </p>
        <form onSubmit={handleSubmit}>
          <label style={lbl}>New Password</label>
          <input type="password" style={inp} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <label style={lbl}>Confirm New Password</label>
          <input type="password" style={inp} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <p style={{ color: "#ba1a1a", fontSize: 13, marginTop: 8 }}>{error}</p>}
          <button
            type="submit"
            disabled={saving}
            style={{ width: "100%", marginTop: 16, padding: "12px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 }}
          >
            {saving ? "Saving..." : "Set Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 12, color: "#48464E", fontWeight: 600, marginBottom: 4, marginTop: 12 };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
