import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../../instrumentation';
import { checkAuthConfigAtBoot } from './boot';

afterEach(() => vi.unstubAllEnvs());

describe('checkAuthConfigAtBoot', () => {
  it('exits with a non-zero code and says why when the config is refused', () => {
    const exit = vi.fn();
    const log = vi.fn();
    checkAuthConfigAtBoot({ CLIENT_BILLING_ENV: 'production', CLIENT_BILLING_AUTH_MODE: 'demo' }, exit as never, log);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(log.mock.calls.flat().join(' ')).toMatch(/demo.*production/i);
  });

  it('keeps running on an accepted config', () => {
    const exit = vi.fn();
    checkAuthConfigAtBoot({}, exit as never, vi.fn());
    expect(exit).not.toHaveBeenCalled();
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
