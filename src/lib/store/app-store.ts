import { createDatabase } from '../db/database';
import { parseStoreConfig } from './config';
import { createPgStore } from './pg/create-pg-store';
import type { TenantStore } from './types';

// Next dev evaluates this module again after a hot reload, and may hold more than one copy of it. The store lives
// on globalThis so a process keeps one pair of pools rather than one per copy.
const holder = globalThis as typeof globalThis & { cbsTenantStore?: TenantStore };

/** The app's store, built on first use from the environment. It throws when no database is configured. */
export function getTenantStore(): TenantStore {
  if (!holder.cbsTenantStore) {
    const result = parseStoreConfig(process.env);
    if (!result.ok) throw new Error(`Refusing to open the store: ${result.reason}`);
    holder.cbsTenantStore = createPgStore(createDatabase(result.config.urls));
  }
  return holder.cbsTenantStore;
}
