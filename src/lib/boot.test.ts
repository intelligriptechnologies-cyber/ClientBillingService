import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../instrumentation';
import { checkConfigAtBoot } from './boot';
import { parseStoreConfig } from './store/config';

afterEach(() => vi.unstubAllEnvs());

const postgres = { DATABASE_URL: 'postgres://cbs_app@db/cbs', DATABASE_PLATFORM_URL: 'postgres://cbs_platform@db/cbs' };

describe('checkConfigAtBoot', () => {
  it('exits with a non-zero code and says why when the auth config is refused, before looking at the store', () => {
    const exit = vi.fn();
    const log = vi.fn();
    checkConfigAtBoot({ CLIENT_BILLING_ENV: 'production', CLIENT_BILLING_AUTH_MODE: 'demo' }, exit as never, log);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join(' ')).toMatch(/demo.*production/i);
  });

  it('exits when no database is configured', () => {
    const exit = vi.fn();
    const log = vi.fn();
    checkConfigAtBoot({}, exit as never, log);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(log.mock.calls.flat().join(' ')).toMatch(/Refusing to start: No database is configured: DATABASE_URL and DATABASE_PLATFORM_URL unset/);
  });

  it('keeps running on an accepted config with Postgres', () => {
    const exit = vi.fn();
    checkConfigAtBoot(postgres, exit as never, vi.fn());
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('parseStoreConfig', () => {
  it.each([
    ['both runtime URLs', postgres, { ok: true, config: { urls: { app: postgres.DATABASE_URL, platform: postgres.DATABASE_PLATFORM_URL } } }],
    ['nothing', {}, { ok: false, reason: expect.stringContaining('DATABASE_URL and DATABASE_PLATFORM_URL unset') }],
    ['only DATABASE_URL', { DATABASE_URL: postgres.DATABASE_URL }, { ok: false, reason: expect.stringContaining('DATABASE_PLATFORM_URL unset') }],
    ['empty URLs', { DATABASE_URL: '', DATABASE_PLATFORM_URL: '' }, { ok: false, reason: expect.stringContaining('DATABASE_URL and DATABASE_PLATFORM_URL unset') }],
  ])('%s', (_name, env, expected) => {
    expect(parseStoreConfig(env)).toEqual(expected);
  });
});

describe('register', () => {
  it('runs the check for the node runtime and exits on a refused config', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('CLIENT_BILLING_ENV', 'production');
    vi.stubEnv('CLIENT_BILLING_AUTH_MODE', 'demo');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});
