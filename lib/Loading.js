"use client";
import { theme } from "./theme";

export default function Loading({ full = true }) {
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
      <img
        src="/logo-mark.png"
        alt="Loading"
        style={{ height: 48, width: "auto", animation: "pulseLogo 1.4s ease-in-out infinite" }}
      />
      <span style={{ fontSize: 13, color: theme.gray }}>Loading...</span>
      <style>{`
        @keyframes pulseLogo {
          0%, 100% { opacity: 0.35; transform: scale(0.96); }
          50% { opacity: 1; transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}
