"use client";
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { usePermissions } from "../lib/usePermissions";

// One-click "see what this user sees", dropped straight onto the patient,
// doctor, employee and client pages so an admin never has to go hunting
// through Settings and search for a record they already have open.
//
// Opens the target's real portal in a new tab with no password step - the
// server mints a short-lived impersonation session and the portal skips its
// forced password-change gate for it. Admin-only; renders nothing otherwise.
export default function LoginAsButton({ type, id, name, size = "normal" }) {
  const { isAdmin } = usePermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isAdmin) return null;

  async function go() {
    setBusy(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/login-as", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token}`,
        },
        body: JSON.stringify({ type, id }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Could not open this portal");
        setBusy(false);
        return;
      }
      window.open(result.link || result.redirect, "_blank");
    } catch (e) {
      setError(e.message || "Could not open this portal");
    }
    setBusy(false);
  }

  const small = size === "small";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button
        onClick={go}
        disabled={busy}
        title={`Open ${name || "this user"}'s portal exactly as they see it`}
        style={{
          padding: small ? "6px 12px" : "9px 16px",
          borderRadius: 8,
          border: `1px solid ${theme.navy}`,
          background: "#fff",
          color: theme.navy,
          fontWeight: 700,
          fontSize: small ? 11 : 13,
          cursor: busy ? "wait" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "Opening..." : "Login As"}
      </button>
      {error && <span style={{ color: "#ba1a1a", fontSize: 11 }}>{error}</span>}
    </span>
  );
}
