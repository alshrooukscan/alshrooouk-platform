// Server-safe core (no "use client"): usable from server components and API
// routes too. Components use the useT() hook from ./index instead.
import AR from "./ar";

export const LOCALES = ["en", "ar"];
export const LANG_COOKIE = "lang";

function interpolate(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

export function translate(locale, text, vars) {
  if (text === null || text === undefined) return text;
  const key = String(text);
  if (locale === "ar") {
    const hit = AR[key] ?? AR[key.trim()];
    if (hit !== undefined) return interpolate(hit, vars);
  }
  return interpolate(key, vars);
}

// Database codes (statuses, methods, kinds): "early_leave" -> "Early leave" / "انصراف مبكر".
export function prettifyCode(code) {
  const s = String(code ?? "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
export function translateCode(locale, code) {
  if (code === null || code === undefined || code === "") return "";
  const c = String(code);
  if (locale === "ar") {
    const hit = AR[`code:${c}`] ?? AR[`code:${c.toLowerCase()}`];
    if (hit !== undefined) return hit;
  }
  return prettifyCode(c);
}
