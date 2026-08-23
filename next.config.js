/** @type {import('next').NextConfig} */
const nextConfig = {
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
