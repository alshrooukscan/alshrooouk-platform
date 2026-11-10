/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Security review S-12: the site sent HSTS only.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera and location are used by the clock-in face check and GPS.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
];

const nextConfig = {
  poweredByHeader: false,
  // Online CBCT viewer (our VolView build) lives in its own Vercel project;
  // served here under /viewer so it can fetch /api/portal/file same-origin.
  async rewrites() {
    return [
      { source: "/viewer", destination: "https://shscan-viewer-test.vercel.app/viewer/" },
      { source: "/viewer/:path*", destination: "https://shscan-viewer-test.vercel.app/viewer/:path*" },
      // Next drops the trailing slash (/viewer/ -> /viewer), so the viewer's
      // relative itk/ paths resolve to /itk; send those to the viewer too.
      { source: "/itk/:path*", destination: "https://shscan-viewer-test.vercel.app/viewer/itk/:path*" },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Face models (about 7 MB) were revalidated on every clock-in. They only
      // change when the files are replaced, so cache them for a week.
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
      { source: "/:file(logo-full.png|logo-mark.png)", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./public/fonts/**"],
  },
  webpack: (config, { isServer }) => {
    // face-api.js/tensorflow.js ship Node-only code paths (filesystem model
    // loading, node-fetch's optional "encoding" dep) that are never actually
    // reached in our usage - we only ever call loadFromUri() in the browser.
    // The "encoding" warning specifically is a known upstream quirk in this
    // library's build output and is harmless (build succeeds, no runtime effect).
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    }
    return config;
  },
};

module.exports = nextConfig;
