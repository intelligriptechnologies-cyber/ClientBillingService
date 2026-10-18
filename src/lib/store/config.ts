type Env = Readonly<Record<string, string | undefined>>;

/** Postgres from the two runtime URLs (ADR 0001, unit D11), or the legacy SQLite store, which unit D12 deletes. */
export type StoreConfig = { driver: 'pg'; urls: { app: string; platform: string } } | { driver: 'sqlite' };
export type StoreConfigResult = { ok: true; config: StoreConfig } | { ok: false; reason: string };

const refuse = (reason: string): StoreConfigResult => ({ ok: false, reason });
const present = (value: string | undefined) => (value === undefined || value === '' ? undefined : value);

/**
 * The SQLite store runs only when asked for by name, so a server that lost its DATABASE_URL refuses to start
 * instead of quietly opening an empty SQLite file. Pure, so every combination can be tested without process.env.
 */
export function parseStoreConfig(env: Env): StoreConfigResult {
  const legacy = present(env.CLIENT_BILLING_STORE);
  const app = present(env.DATABASE_URL);
  const platform = present(env.DATABASE_PLATFORM_URL);
  if (legacy !== undefined && legacy !== 'sqlite') return refuse(`CLIENT_BILLING_STORE must be sqlite or unset, not ${legacy}.`);
  if (legacy === 'sqlite') {
    if (app || platform) return refuse('Set DATABASE_URL and DATABASE_PLATFORM_URL for Postgres, or CLIENT_BILLING_STORE=sqlite for the legacy SQLite store, not both.');
    return { ok: true, config: { driver: 'sqlite' } };
  }
  if (!app || !platform) return refuse(`No database is configured: ${[!app && 'DATABASE_URL', !platform && 'DATABASE_PLATFORM_URL'].filter(Boolean).join(' and ')} unset. Set both for Postgres. CLIENT_BILLING_STORE=sqlite runs the legacy SQLite store instead.`);
  return { ok: true, config: { driver: 'pg', urls: { app, platform } } };
}
