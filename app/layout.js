export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { LocaleProvider } from "../lib/i18n";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";

export const metadata = {
  // Spelled the way the logo does - ALSHROOUK, two o's. The app had been
  // carrying a third one that appears nowhere on the brand itself.
  title: "Alshroouk Lab & Scan",
  description: "Staff Portal",
};

export const viewport = { width: "device-width", initialScale: 1 };

// One stylesheet for the whole app (30 Oct 2026). Every page is styled inline,
// so nothing below a certain width was ever handled: on a phone, a long file
// name pushed the doctor portal past the edge of the screen, two-column grids
// stayed two columns at 393px, and fixed-width boxes ran off the side.
//
// These rules target those patterns everywhere at once, by what the inline
// styles say (React writes them as style="grid-template-columns: ..."):
//  - long words, file names, emails and links wrap instead of overflowing
//  - grid columns may shrink below their longest word (the doctor portal bug)
//  - on phones, multi-column grids collapse (2 columns for stat rows, 1 for
//    layouts), tables scroll inside themselves, nothing is wider than its
//    container, and the staff dashboard drops its 32px padding
const GLOBAL_CSS = `
  body { overflow-wrap: break-word; -webkit-text-size-adjust: 100%; }
  th, button, [style*="nowrap"] { overflow-wrap: normal; }
  img, video { max-width: 100%; height: auto; }
  input, select, textarea, button { max-width: 100%; box-sizing: border-box; font-family: inherit; }
  [style*="grid-template-columns"] > * { min-width: 0; }

  @media (max-width: 700px) {
    main { padding: 14px !important; min-width: 0; }
    [style*="grid-template-columns"][style*="repeat(3"], [style*="grid-template-columns"][style*="repeat(4"],
    [style*="grid-template-columns"][style*="repeat(5"], [style*="grid-template-columns"][style*="repeat(6"] {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }
    [style*="grid-template-columns"][style*="1fr 1fr"], [style*="grid-template-columns"][style*="repeat(2"],
    [style*="grid-template-columns"][style*="1.1fr"], [style*="grid-template-columns"][style*="1.2fr"],
    [style*="grid-template-columns"][style*="1.3fr"], [style*="grid-template-columns"][style*="1.4fr"],
    [style*="grid-template-columns"][style*="minmax(0"], [style*="grid-template-columns"][style*="1fr 120px"],
    [style*="grid-template-columns"][style*="minmax(220px, 300px)"],
    [style*="minmax(220px, 1fr)"], [style*="minmax(240px"], [style*="minmax(260px"], [style*="minmax(330px"] {
      grid-template-columns: minmax(0, 1fr) !important;
    }
    div:not([style*="absolute"]), form, section, header, nav, p, a, label, h1, h2, h3, h4 { max-width: 100%; }
    [style*="display: flex"]:not([style*="column"]):not([style*="nowrap"]),
    [style*="display:flex"]:not([style*="column"]):not([style*="nowrap"]) { flex-wrap: wrap; row-gap: 8px; }
    table { display: block; overflow-x: auto; max-width: 100%; -webkit-overflow-scrolling: touch; }
    [style*="fixed"] > div { max-width: calc(100vw - 20px); }
    h1 { font-size: 22px; }
  }

  /* Arabic (right-to-left). The language toggle sets <html lang="ar" dir="rtl">. */
  html[lang="ar"] body { font-family: "IBM Plex Sans Arabic", system-ui, sans-serif !important; line-height: 1.6; }
  html[lang="ar"] input, html[lang="ar"] select, html[lang="ar"] textarea, html[lang="ar"] button { font-family: inherit; }
  /* Numbers, phones, emails and dates are typed left-to-right even in Arabic. */
  html[dir="rtl"] input[type="number"], html[dir="rtl"] input[type="tel"], html[dir="rtl"] input[type="email"],
  html[dir="rtl"] input[type="date"], html[dir="rtl"] input[type="time"], html[dir="rtl"] input[type="datetime-local"],
  html[dir="rtl"] input[type="month"], html[dir="rtl"] input[type="password"], html[dir="rtl"] input[type="url"] {
    direction: ltr; text-align: right;
  }
  /* Charts read left-to-right (time runs that way) in both languages. */
  html[dir="rtl"] .recharts-wrapper, html[dir="rtl"] .recharts-responsive-container { direction: ltr; }
`;

export default function RootLayout({ children }) {
  // English by default; Arabic when the person chose it with the toggle.
  const locale = cookies().get("lang")?.value === "ar" ? "ar" : "en";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
