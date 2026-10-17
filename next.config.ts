import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // playwright-core reads browsers.json and other files at runtime that tracing cannot see.
  outputFileTracingIncludes: { '/api/invoices/*/download': ['./node_modules/playwright-core/**/*'] },
};

export default nextConfig;
