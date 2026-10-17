/**
 * The one place client code calls the app's API (ADR 0002, decision 15).
 *
 * Behind Authelia an expired session answers 401 to a request it detects as XHR, or a cross-origin
 * redirect to the portal. With redirect: 'manual' the redirect comes back as an opaque response
 * instead of a failed fetch. Either way the page reloads so the browser takes Authelia's normal
 * redirect to the portal.
 */
type ApiFetchDeps = { fetchImpl: typeof fetch; reload: () => void };

export function createApiFetch({ fetchImpl, reload }: ApiFetchDeps): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('X-Requested-With', 'XMLHttpRequest');
    const response = await fetchImpl(input, { ...init, headers, redirect: 'manual' });
    if (response.type === 'opaqueredirect' || response.status === 401) reload();
    return response;
  };
}

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>;
const lastReloadKey = 'cbs-api-client-last-reload';

/** A 401 the portal cannot fix would otherwise reload the page forever. */
export function createGuardedReload(storage: ReloadStorage | undefined, reload: () => void, now: () => number = Date.now, windowMs = 10_000): () => void {
  return () => {
    try {
      const last = Number(storage?.getItem(lastReloadKey));
      if (last && now() - last < windowMs) return;
      storage?.setItem(lastReloadKey, String(now()));
    } catch { /* storage blocked: reload without the guard */ }
    reload();
  };
}

function browserStorage(): ReloadStorage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

export const apiFetch: typeof fetch = createApiFetch({
  fetchImpl: (input, init) => fetch(input, init),
  reload: () => createGuardedReload(browserStorage(), () => window.location.reload())(),
});
