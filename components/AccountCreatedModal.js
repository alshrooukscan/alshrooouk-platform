"use client";
import { theme } from "../lib/theme";

// Shown right after creating a new patient, doctor, or employee so the person
// creating the record sees the generated login immediately, rather than
// having to go find it afterward on the profile page.
export default function AccountCreatedModal({ username, password, whatsappLink, onContinue, continueLabel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,11,56,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 420, maxWidth: "90vw" }}>
        <h3 style={{ color: theme.navy, marginTop: 0, marginBottom: 4 }}>Account Created Successfully</h3>
        <p style={{ fontSize: 12, color: theme.gray, marginTop: 0, marginBottom: 16 }}>
          Share this login now - the password won't be shown again after you leave this page.
        </p>
        <div style={{ background: "#e8f5e9", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            <strong>Username:</strong> {username}
          </div>
          <div style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <strong>Password:</strong>
            <code style={{ background: "#fff", padding: "3px 10px", borderRadius: 4, fontSize: 14 }}>{password}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(password)}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #cde5cf", background: "#fff", cursor: "pointer", fontWeight: 600, color: theme.navy }}
            >
              Copy
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {whatsappLink && (
            <a
              href={whatsappLink}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, padding: "12px 0", borderRadius: 8, background: "#25D366", color: "#fff", fontWeight: 700, textDecoration: "none", textAlign: "center", fontSize: 14 }}
            >
              Send via WhatsApp
            </a>
          )}
          <button
            onClick={onContinue}
            style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 700, cursor: "pointer" }}
          >
            {continueLabel || "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
