"use client";
import { useT } from "../lib/i18n";

// "View online" for raw CBCT data (Mohamed Said, 10 Nov 2026). Opens our
// build of the open-source VolView viewer at /viewer (proxied from its own
// Vercel project), which streams the zip through the same /api/portal/file
// proxy the download link uses, so it stays same-origin and needs no Google
// account. Only .zip / .dcm files get the button.
export function isViewableScan(name) {
  return /\.(zip|dcm)$/i.test(String(name || ""));
}

export function viewerUrl(fileId, name) {
  const ext = /\.dcm$/i.test(String(name || "")) ? "dcm" : "zip";
  // VolView splits names/urls on commas, so give it a plain name.
  const origin = typeof window !== "undefined" ? window.location.origin : "https://shscan.com";
  return `/viewer/?names=[scan.${ext}]&urls=[${origin}/api/portal/file/${encodeURIComponent(fileId)}]`;
}

export default function ViewOnlineLink({ fileId, name, style }) {
  const { t } = useT();
  if (!fileId || !isViewableScan(name)) return null;
  return (
    <a
      href={viewerUrl(fileId, name)}
      target="_blank"
      rel="noreferrer"
      title={t("Opens the 3D viewer in a new tab. Works best on a computer.")}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-block", marginTop: 6, padding: "4px 10px", borderRadius: 6,
        background: "#27214d", color: "#fff", fontSize: 11, fontWeight: 700, textDecoration: "none",
        ...style,
      }}
    >
      {t("View online (3D)")}
    </a>
  );
}
