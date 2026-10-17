import { describe, expect, it, vi } from 'vitest';
import { createApiFetch, createGuardedReload } from './api-client';

function setup(respond: (input: RequestInfo | URL, init?: RequestInit) => Response) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ input, init }); return respond(input, init); });
  const reload = vi.fn();
  return { apiFetch: createApiFetch({ fetchImpl: fetchImpl as unknown as typeof fetch, reload }), reload, calls };
}

// Response cannot be constructed with type "opaqueredirect", so the browser's answer to redirect: 'manual' is faked.
const opaqueRedirect = () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() }) as unknown as Response;

describe('apiFetch', () => {
  it('reloads once on a 401 that carries the portal Location', async () => {
    const { apiFetch, reload } = setup(() => new Response(null, { status: 401, headers: { location: 'https://auth.example.com/?rd=x' } }));
    expect((await apiFetch('/api/customers')).status).toBe(401);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once on an opaque redirect', async () => {
    const { apiFetch, reload } = setup(opaqueRedirect);
    await apiFetch('/api/customers');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once on a bare 401, because Authelia is not known to add a Location to its XHR answer', async () => {
    const { apiFetch, reload } = setup(() => Response.json({ message: 'Sign in is required.' }, { status: 401 }));
    await apiFetch('/api/customers');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([200, 201, 400, 403, 404, 500])('does not reload on a %i', async (status) => {
    const { apiFetch, reload } = setup(() => new Response(status === 200 || status === 201 ? '{}' : null, { status }));
    expect((await apiFetch('/api/customers')).status).toBe(status);
    expect(reload).not.toHaveBeenCalled();
  });

  it('marks the request as XHR and asks fetch not to follow redirects, keeping the caller\'s own options', async () => {
    const { apiFetch, calls } = setup(() => new Response('{}'));
    await apiFetch('/api/customers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', redirect: 'follow' });
    const { init } = calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('x-requested-with')).toBe('XMLHttpRequest');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init?.redirect).toBe('manual');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
  });

  it('returns the response so callers still run their own error path', async () => {
    const { apiFetch } = setup(() => Response.json({ message: 'Sign in is required.' }, { status: 401 }));
    const response = await apiFetch('/api/customers');
    expect(await response.json()).toEqual({ message: 'Sign in is required.' });
  });

  it('passes a thrown network error through without reloading', async () => {
    const reload = vi.fn();
    const apiFetch = createApiFetch({ fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch, reload });
    await expect(apiFetch('/api/customers')).rejects.toThrow('Failed to fetch');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('createGuardedReload', () => {
  function storage() {
    const map = new Map<string, string>();
    return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  }

  it('reloads again only after the window, so a page whose own 401 survives a reload cannot loop', () => {
    const reload = vi.fn();
    let clock = 1_000_000;
    const guarded = createGuardedReload(storage(), reload, () => clock, 10_000);
    guarded();
    clock += 5_000;
    guarded();
    expect(reload).toHaveBeenCalledTimes(1);
    clock += 6_000;
    guarded();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('reloads without a guard when storage is unavailable', () => {
    const reload = vi.fn();
    createGuardedReload(undefined, reload)();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when storage throws', () => {
    const reload = vi.fn();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    createGuardedReload(broken, reload)();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
