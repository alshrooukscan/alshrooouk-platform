"use client";
import { useState, useRef, useEffect } from "react";
import { theme } from "../lib/theme";

// Generic "Send WhatsApp" dropdown - options are just {label, onClick} pairs,
// so the same component serves the patient (5 options), doctor (4), and
// client (3) message-type sets without needing separate implementations.
export default function WhatsAppDropdown({ options, buttonStyle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={buttonStyle || { padding: "7px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: theme.navy, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
      >
        Send WhatsApp \u25be
      </button>
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, background: "#fff", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.12)", minWidth: 160, zIndex: 30, overflow: "hidden" }}>
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => {
                setOpen(false);
                opt.onClick();
              }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "#fff", cursor: "pointer", fontSize: 13, color: theme.navy }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#faf9fb")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
