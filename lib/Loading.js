"use client";
import { theme } from "./theme";

// logo: a URL to show instead of ours (a client's white-label portal), or false
// for a plain spinner while we do not yet know whose page this is.
export default function Loading({ full = true, logo }) {
  return (
    <div
      style={{
        minHeight: full ? "100vh" : "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: full ? 0 : 40,
      }}
    >
      {logo === false ? (
        <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid #e3e1ea", borderTopColor: theme.navy, animation: "spinLoad 0.9s linear infinite" }} />
      ) : (
        <img
          src={logo || "/logo-mark.png"}
          alt="Loading"
          style={{ height: logo ? 72 : 48, width: "auto", maxWidth: 220, objectFit: "contain", animation: "pulseLogo 1.4s ease-in-out infinite" }}
        />
      )}
      <span style={{ fontSize: 13, color: theme.gray }}>Loading...</span>
      <style>{`
        @keyframes spinLoad { to { transform: rotate(360deg); } }
        @keyframes pulseLogo {
          0%, 100% { opacity: 0.35; transform: scale(0.96); }
          50% { opacity: 1; transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}
