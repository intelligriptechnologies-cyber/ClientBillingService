import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Only the e2e suite sets this, so its authelia-mode server can run beside the demo server.
  distDir: process.env.CLIENT_BILLING_DIST_DIR ?? '.next',
  output: 'standalone',
  // playwright-core reads browsers.json and other files at runtime that tracing cannot see.
  outputFileTracingIncludes: { '/api/invoices/*/download': ['./node_modules/playwright-core/**/*'] },
};

export default nextConfig;
