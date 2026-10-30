"use client";
// Arabic / English for the whole platform (MO, 30 Oct 2026).
//
// English is the default for everyone; each person picks Arabic with the
// language toggle. The choice lives in the `lang` cookie so the server can set
// <html lang dir> before the first paint (no flash of the wrong direction).
//
// Keys are the English text itself (gettext style): t("Save") shows "Save" in
// English and the Arabic from lib/i18n/ar/* in Arabic. Anything without an
// Arabic entry falls back to the English, so untranslated text never shows up
// blank. Placeholders use {name}: t("Paid on {date}", { date }).
//
// Inside components use the hook: const { t, tCode, locale, isAr } = useT();
// In event handlers, alert()/confirm() text and plain helpers use tx() / txCode().
import { createContext, useContext, useMemo } from "react";
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

// Client-only: the locale from the cookie (for handlers, alerts and helpers).
export function currentLocale() {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)lang=(en|ar)\b/);
  return m ? m[1] : "en";
}
export function tx(text, vars) {
  return translate(currentLocale(), text, vars);
}
export function txCode(code) {
  return translateCode(currentLocale(), code);
}

export function setLocale(locale) {
  const l = LOCALES.includes(locale) ? locale : "en";
  document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  // A full reload re-renders every page from the server with the new
  // direction; switching language is rare, so this is the safest way.
  window.location.reload();
}

const LocaleContext = createContext("en");

export function LocaleProvider({ locale = "en", children }) {
  return <LocaleContext.Provider value={locale === "ar" ? "ar" : "en"}>{children}</LocaleContext.Provider>;
}

export function useT() {
  const locale = useContext(LocaleContext);
  return useMemo(
    () => ({
      locale,
      isAr: locale === "ar",
      dir: locale === "ar" ? "rtl" : "ltr",
      t: (text, vars) => translate(locale, text, vars),
      tCode: (code) => translateCode(locale, code),
      setLocale,
    }),
    [locale]
  );
}

// Numbers, phones, emails, IDs and money inside Arabic text: keep them
// left-to-right so "+20 10..." and "1,200 EGP" don't get scrambled.
export function Ltr({ children, style }) {
  return (
    <bdi dir="ltr" style={{ unicodeBidi: "isolate", ...style }}>
      {children}
    </bdi>
  );
}
