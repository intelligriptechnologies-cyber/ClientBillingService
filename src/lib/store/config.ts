type Env = Readonly<Record<string, string | undefined>>;

/** The two runtime URLs of the Postgres store (ADR 0001). */
export type StoreConfig = { urls: { app: string; platform: string } };
export type StoreConfigResult = { ok: true; config: StoreConfig } | { ok: false; reason: string };

const present = (value: string | undefined) => (value === undefined || value === '' ? undefined : value);

/** Pure, so every combination can be tested without process.env. A server that lost a URL refuses to start. */
export function parseStoreConfig(env: Env): StoreConfigResult {
  const app = present(env.DATABASE_URL);
  const platform = present(env.DATABASE_PLATFORM_URL);
  if (!app || !platform) return { ok: false, reason: `No database is configured: ${[!app && 'DATABASE_URL', !platform && 'DATABASE_PLATFORM_URL'].filter(Boolean).join(' and ')} unset. Set both for Postgres.` };
  return { ok: true, config: { urls: { app, platform } } };
}
