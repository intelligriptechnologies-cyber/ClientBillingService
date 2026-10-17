type Env = Readonly<Record<string, string | undefined>>;

const appEnvs = ['development', 'test', 'staging', 'demo', 'production'] as const;
export type AppEnv = (typeof appEnvs)[number];

const minimumSecretBytes = 32;

type Base = { env: AppEnv; publicOrigin?: string };
export type DemoAuthConfig = Base & { mode: 'demo' };
export type AutheliaAuthConfig = Base & { mode: 'authelia'; proxySecret: string; memberGroup: string; superadminGroup: string; logoutUrl: string };
export type AuthConfig = DemoAuthConfig | AutheliaAuthConfig;
export type AuthConfigResult = { ok: true; config: AuthConfig } | { ok: false; reason: string };

const refuse = (reason: string): AuthConfigResult => ({ ok: false, reason });
const present = (value: string | undefined) => (value === undefined || value === '' ? undefined : value);

function parseGroup(name: string, value: string | undefined): string | { error: string } {
  const group = value?.trim();
  if (!group) return { error: `${name} is required in authelia mode.` };
  if (group.includes(',')) return { error: `${name} must be one group name without commas.` };
  return group;
}

function parseOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash || url.username) return undefined;
    return url.origin;
  } catch { return undefined; }
}

/** Pure, so every environment and mode pair can be tested without touching process.env. */
export function parseAuthConfig(env: Env): AuthConfigResult {
  const rawEnv = present(env.CLIENT_BILLING_ENV);
  const appEnv = rawEnv === undefined ? 'development' : appEnvs.find((candidate) => candidate === rawEnv);
  if (!appEnv) return refuse(`CLIENT_BILLING_ENV must be one of ${appEnvs.join(', ')}.`);

  const rawMode = present(env.CLIENT_BILLING_AUTH_MODE) ?? 'demo';
  if (rawMode !== 'demo' && rawMode !== 'authelia') return refuse('CLIENT_BILLING_AUTH_MODE must be demo or authelia.');

  const rawOrigin = present(env.CBS_PUBLIC_ORIGIN);
  const publicOrigin = rawOrigin === undefined ? undefined : parseOrigin(rawOrigin);
  if (rawOrigin !== undefined && publicOrigin === undefined) return refuse('CBS_PUBLIC_ORIGIN must be an http(s) origin without a path.');
  const base = { env: appEnv, ...(publicOrigin ? { publicOrigin } : {}) };

  if (rawMode === 'demo') {
    if (appEnv === 'production') return refuse('Demo auth mode is refused when CLIENT_BILLING_ENV is production.');
    return { ok: true, config: { mode: 'demo', ...base } };
  }

  const proxySecret = present(env.CBS_PROXY_SECRET);
  if (proxySecret === undefined || Buffer.byteLength(proxySecret) < minimumSecretBytes) return refuse(`CBS_PROXY_SECRET is required in authelia mode and must be at least ${minimumSecretBytes} bytes.`);
  const memberGroup = parseGroup('CBS_AUTH_MEMBER_GROUP', env.CBS_AUTH_MEMBER_GROUP);
  if (typeof memberGroup !== 'string') return refuse(memberGroup.error);
  const superadminGroup = parseGroup('CBS_AUTH_SUPERADMIN_GROUP', env.CBS_AUTH_SUPERADMIN_GROUP);
  if (typeof superadminGroup !== 'string') return refuse(superadminGroup.error);
  if (memberGroup === superadminGroup) return refuse('CBS_AUTH_MEMBER_GROUP and CBS_AUTH_SUPERADMIN_GROUP must differ.');
  const logoutUrl = present(env.CBS_AUTHELIA_LOGOUT_URL);
  if (logoutUrl === undefined || !/^https?:\/\//i.test(logoutUrl) || !URL.canParse(logoutUrl)) return refuse('CBS_AUTHELIA_LOGOUT_URL must be an absolute http(s) URL.');
  return { ok: true, config: { mode: 'authelia', ...base, proxySecret, memberGroup, superadminGroup, logoutUrl } };
}

export class AuthConfigError extends Error {}

/** Reads process.env on every call so handlers never act on a stale mode. */
export function readAuthConfig(): AuthConfigResult { return parseAuthConfig(process.env); }

export function getAuthConfig(): AuthConfig {
  const result = readAuthConfig();
  if (!result.ok) throw new AuthConfigError(result.reason);
  return result.config;
}
