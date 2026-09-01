"use client";
import { theme } from "../lib/theme";

// Shown at the top of any portal that was opened through admin "Login As".
// Without this an admin can genuinely forget they're inside someone else's
// account and mistake the impersonated view for their own - so it stays
// visible, unmissable, and offers the way out.
export default function ImpersonationBanner({ impersonatedBy, name }) {
  if (!impersonatedBy) return null;

  async function exit() {
    await fetch("/api/portal/logout", { method: "POST" });
    window.close();
    window.location.href = "/dashboard";
  }

  return (
    <div
      style={{
        background: "#7a5c00",
        color: "#fff",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 12,
        fontWeight: 600,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <span>
        Viewing as {name || "this user"} &middot; opened by {impersonatedBy}. Nothing you do here is
        recorded as your own account.
      </span>
      <button
        onClick={exit}
        style={{
          padding: "4px 12px",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.6)",
          background: "transparent",
          color: "#fff",
          fontWeight: 700,
          fontSize: 11,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Exit
      </button>
    </div>
  );
}
