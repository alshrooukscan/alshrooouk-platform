export const dynamic = "force-dynamic";

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
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
