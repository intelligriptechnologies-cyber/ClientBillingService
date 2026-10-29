import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Only the e2e suite sets this, so its authelia-mode server can run beside the demo server.
  distDir: process.env.CLIENT_BILLING_DIST_DIR ?? '.next',
  output: 'standalone',
  // nodemailer loads its own submodules by path at runtime, so it stays out of the server bundle; standalone tracing still copies it.
  serverExternalPackages: ['nodemailer', 'argon2'],
  // playwright-core reads browsers.json and other files at runtime that tracing cannot see.
  outputFileTracingIncludes: { '/*': ['./node_modules/argon2/prebuilds/**/*'], '/api/invoices/*/download': ['./node_modules/playwright-core/**/*'], '/api/invoices/*/send': ['./node_modules/playwright-core/**/*'] },
};

export default nextConfig;
