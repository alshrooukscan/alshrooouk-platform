"use client";
import { useState } from "react";
import { theme } from "../lib/theme";

// Shared "generate login / reset password" UI for patient, doctor, and employee
// cards. Each caller supplies its own onGenerate() that calls the right
// create_*_credentials RPC - the same RPC handles both first-time generation
// and password resets (calling it again on an existing account just issues a
// fresh temp password), so this component only needs one action, labeled
// differently depending on whether an account already exists.
export default function PortalAccessCard({ hasAccount, username, defaultUsername, onGenerate }) {
  const [usernameDraft, setUsernameDraft] = useState(username || defaultUsername || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleGenerate() {
    if (!usernameDraft) {
      setError("Enter a username.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const pwd = await onGenerate(usernameDraft);
      if (!pwd) throw new Error("Could not generate credentials.");
      setResult({ username: usernameDraft, password: pwd });
    } catch (e) {
      setError(e.message || "Failed to generate credentials.");
    }
    setBusy(false);
  }

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 4px 20px rgba(39,33,77,0.06)" }}>
      <h3 style={{ color: theme.navy, marginTop: 0, marginBottom: 4 }}>Portal Access</h3>
      <p style={{ fontSize: 12, color: theme.gray, marginTop: 0, marginBottom: 16 }}>
        The username and password used to log in to their own portal.
      </p>

      {result ? (
        <div style={{ background: "#e8f5e9", borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 12, color: "#2e7d32", fontWeight: 700, margin: "0 0 10px" }}>
            Share these now - the password won't be shown again after you leave this page.
          </p>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            <strong>Username:</strong> {result.username}
          </div>
          <div style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <strong>Password:</strong>
            <code style={{ background: "#fff", padding: "3px 10px", borderRadius: 4, fontSize: 14 }}>{result.password}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(result.password)}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #cde5cf", background: "#fff", cursor: "pointer", color: theme.navy, fontWeight: 600 }}
            >
              Copy
            </button>
          </div>
          <button
            onClick={() => setResult(null)}
            style={{ marginTop: 12, fontSize: 12, color: theme.gray, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Done
          </button>
        </div>
      ) : hasAccount ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, color: theme.gray }}>Username</div>
            <div style={{ fontSize: 15, color: theme.navy, fontWeight: 700 }}>{username}</div>
          </div>
          <button onClick={handleGenerate} disabled={busy} style={btnStyle}>
            {busy ? "Resetting..." : "Reset Password"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={usernameDraft}
            onChange={(e) => setUsernameDraft(e.target.value)}
            placeholder="Username"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }}
          />
          <button onClick={handleGenerate} disabled={busy} style={btnStyle}>
            {busy ? "Generating..." : "Generate Login"}
          </button>
        </div>
      )}
      {error && <p style={{ color: "#ba1a1a", fontSize: 13, marginTop: 8, marginBottom: 0 }}>{error}</p>}
    </div>
  );
}

const btnStyle = { padding: "10px 20px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" };
