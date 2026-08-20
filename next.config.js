/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./public/fonts/**"],
  },
};

module.exports = nextConfig;
