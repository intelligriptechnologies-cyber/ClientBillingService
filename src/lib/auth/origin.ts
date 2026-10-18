const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type OriginInput = {
  method: string;
  pathname: string;
  /** The scheme the app saw, without the colon. A forwarded scheme overrides it. */
  protocol: string;
  headers: Headers;
  /** What authenticates a browser request. In demo mode it is the cookie. In authelia mode it is headers a proxy adds. */
  credentials: 'cookie' | 'proxy-headers';
  /** Exact origin of the site. When set it replaces the Host comparison. */
  publicOrigin?: string;
};

function isBearerRequestToApiV1({ pathname, headers }: OriginInput) {
  return pathname.startsWith('/api/v1/') && /^bearer\s+\S+/i.test(headers.get('authorization') ?? '');
}

/**
 * CSRF defence for cookie-authenticated requests (ADR 0002, decision 14), on top of SameSite=Lax.
 * A browser always sends Origin on a cross-origin or same-origin POST, PUT, PATCH or DELETE.
 * The Origin string is compared as text, never parsed, so userinfo or a lookalike host cannot pass.
 */
export function checkOrigin(input: OriginInput): { ok: true } | { ok: false } {
  const { method, pathname, headers, credentials, publicOrigin } = input;
  if (!stateChanging.has(method.toUpperCase())) return { ok: true };
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return { ok: true };
  if (isBearerRequestToApiV1(input)) return { ok: true };
  // Behind the proxy the cookie may be dropped or rewritten, so only demo mode may skip a cookieless request.
  if (credentials === 'cookie' && !headers.get('cookie')) return { ok: true };

  const origin = headers.get('origin')?.toLowerCase();
  if (!origin) return { ok: false };
  if (publicOrigin) return origin === publicOrigin.toLowerCase() ? { ok: true } : { ok: false };
  const host = headers.get('host')?.toLowerCase();
  if (!host) return { ok: false };
  const scheme = (headers.get('x-forwarded-proto')?.split(',')[0].trim() || input.protocol).toLowerCase();
  return origin === `${scheme}://${host}` ? { ok: true } : { ok: false };
}
