import { describe, expect, it } from 'vitest';
import { parseAuthConfig } from './config';

const secret = 's'.repeat(32);
const authelia = {
  CLIENT_BILLING_AUTH_MODE: 'authelia',
  CBS_PROXY_SECRET: secret,
  CBS_AUTH_MEMBER_GROUP: 'cbs-users',
  CBS_AUTH_SUPERADMIN_GROUP: 'cbs-superadmin',
  CBS_AUTHELIA_LOGOUT_URL: 'https://auth.example.com/logout',
};

describe('parseAuthConfig mode and environment', () => {
  const envs = ['development', 'test', 'staging', 'demo', 'production'] as const;
  const table = envs.flatMap((env) => (['demo', 'authelia'] as const).map((mode) => ({ env, mode })));

  it.each(table)('$mode in $env', ({ env, mode }) => {
    const result = parseAuthConfig({ CLIENT_BILLING_ENV: env, ...(mode === 'authelia' ? authelia : { CLIENT_BILLING_AUTH_MODE: 'demo' }) });
    if (env === 'production' && mode === 'demo') {
      expect(result).toMatchObject({ ok: false });
      expect(result.ok === false && result.reason).toMatch(/demo.*production/i);
    } else {
      expect(result).toMatchObject({ ok: true, config: { mode, env } });
    }
  });

  it('defaults to demo in development when nothing is set, so existing tests and the seeded demo keep working', () => {
    expect(parseAuthConfig({})).toEqual({ ok: true, config: { mode: 'demo', env: 'development' } });
    expect(parseAuthConfig({ CLIENT_BILLING_AUTH_MODE: '', CLIENT_BILLING_ENV: '' })).toEqual({ ok: true, config: { mode: 'demo', env: 'development' } });
  });

  it.each(['Authelia', 'password', 'DEMO', ' demo'])('refuses the unknown mode %j instead of defaulting to demo', (mode) => {
    expect(parseAuthConfig({ CLIENT_BILLING_AUTH_MODE: mode })).toMatchObject({ ok: false });
  });

  it.each(['prod', 'Production', 'live', 'production '])('refuses the unknown environment %j, so a typo cannot bypass the production guard', (env) => {
    expect(parseAuthConfig({ CLIENT_BILLING_ENV: env })).toMatchObject({ ok: false });
  });
});

describe('parseAuthConfig authelia settings', () => {
  const parse = (overrides: Record<string, string | undefined>) => parseAuthConfig({ CLIENT_BILLING_ENV: 'staging', ...authelia, ...overrides });

  it('returns every authelia setting', () => {
    expect(parse({})).toEqual({
      ok: true,
      config: { mode: 'authelia', env: 'staging', proxySecret: secret, memberGroup: 'cbs-users', superadminGroup: 'cbs-superadmin', logoutUrl: 'https://auth.example.com/logout' },
    });
  });

  it('refuses a missing, empty or short proxy secret', () => {
    expect(parse({ CBS_PROXY_SECRET: undefined })).toMatchObject({ ok: false });
    expect(parse({ CBS_PROXY_SECRET: '' })).toMatchObject({ ok: false });
    expect(parse({ CBS_PROXY_SECRET: 's'.repeat(31) })).toMatchObject({ ok: false });
    expect(parse({ CBS_PROXY_SECRET: 's'.repeat(32) })).toMatchObject({ ok: true });
  });

  it('counts the secret in bytes, not characters', () => {
    expect(parse({ CBS_PROXY_SECRET: 'é'.repeat(16) })).toMatchObject({ ok: true });
    expect(parse({ CBS_PROXY_SECRET: 'é'.repeat(15) })).toMatchObject({ ok: false });
  });

  it.each(['CBS_AUTH_MEMBER_GROUP', 'CBS_AUTH_SUPERADMIN_GROUP'])('refuses a missing or malformed %s', (name) => {
    expect(parse({ [name]: undefined })).toMatchObject({ ok: false });
    expect(parse({ [name]: '   ' })).toMatchObject({ ok: false });
    expect(parse({ [name]: 'a,b' })).toMatchObject({ ok: false });
  });

  it('refuses one group name for both roles, which would make every member a platform superadmin', () => {
    expect(parse({ CBS_AUTH_SUPERADMIN_GROUP: 'cbs-users' })).toMatchObject({ ok: false });
  });

  it('refuses a missing or non-http logout url', () => {
    expect(parse({ CBS_AUTHELIA_LOGOUT_URL: undefined })).toMatchObject({ ok: false });
    expect(parse({ CBS_AUTHELIA_LOGOUT_URL: '/logout' })).toMatchObject({ ok: false });
    expect(parse({ CBS_AUTHELIA_LOGOUT_URL: 'javascript:alert(1)' })).toMatchObject({ ok: false });
  });

  it('does not require authelia settings in demo mode', () => {
    expect(parseAuthConfig({ CLIENT_BILLING_AUTH_MODE: 'demo', CBS_PROXY_SECRET: 'short' })).toMatchObject({ ok: true, config: { mode: 'demo' } });
  });

  it('accepts an optional exact public origin for the Origin check and refuses a malformed one', () => {
    expect(parse({ CBS_PUBLIC_ORIGIN: 'https://billing.example.com' })).toMatchObject({ ok: true, config: { publicOrigin: 'https://billing.example.com' } });
    expect(parse({ CBS_PUBLIC_ORIGIN: 'https://billing.example.com/' })).toMatchObject({ ok: true, config: { publicOrigin: 'https://billing.example.com' } });
    expect(parseAuthConfig({ CBS_PUBLIC_ORIGIN: 'http://localhost:3100' })).toMatchObject({ ok: true, config: { publicOrigin: 'http://localhost:3100' } });
    expect(parse({ CBS_PUBLIC_ORIGIN: 'billing.example.com' })).toMatchObject({ ok: false });
    expect(parse({ CBS_PUBLIC_ORIGIN: 'https://billing.example.com/path' })).toMatchObject({ ok: false });
  });

  it('never echoes the secret in a refusal', () => {
    const result = parse({ CBS_PROXY_SECRET: 'tooshort-secret' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('tooshort-secret');
  });
});
