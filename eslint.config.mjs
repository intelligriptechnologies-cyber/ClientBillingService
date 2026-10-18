import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Call apiFetch from @/lib/api-client so an expired session reloads the page (ADR 0002, decision 15).' }],
    },
  },
  globalIgnores(['.next/**', '.next-*/**', 'node_modules/**', 'coverage/**', '.claude/**']),
]);
