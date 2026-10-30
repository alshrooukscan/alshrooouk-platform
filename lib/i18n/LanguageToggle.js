"use client";
import { useT } from "./index";

// One button: shows the language you can switch TO.
export default function LanguageToggle({ style, compact = false }) {
  const { isAr, setLocale } = useT();
  return (
    <button
      type="button"
      onClick={() => setLocale(isAr ? "en" : "ar")}
      title={isAr ? "Switch to English" : "التحويل للعربي"}
      style={{
        border: "1px solid rgba(127,127,127,0.35)",
        background: "transparent",
        color: "inherit",
        borderRadius: 8,
        padding: compact ? "4px 8px" : "6px 12px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: isAr ? "system-ui, sans-serif" : "'IBM Plex Sans Arabic', system-ui, sans-serif",
        ...style,
      }}
    >
      {isAr ? "English" : "عربي"}
    </button>
  );
}
