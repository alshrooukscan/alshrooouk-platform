/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./public/fonts/**"],
  },
  webpack: (config, { isServer }) => {
    // face-api.js/tensorflow.js ship Node-only code paths (filesystem model
    // loading, node-fetch's optional "encoding" dep) that are never actually
    // reached in our usage - we only ever call loadFromUri() in the browser.
    // Stubbing these out avoids noisy build warnings without touching runtime behavior.
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, encoding: false };
    }
    return config;
  },
};

module.exports = nextConfig;
