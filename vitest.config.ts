import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globalSetup: ['src/lib/db/global-setup.ts'],
    exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**', '**/.next/**', '**/.claude/**', '**/.worktrees/**'],
  },
});
