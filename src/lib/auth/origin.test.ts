import { describe, expect, it } from 'vitest';
import { checkOrigin } from './origin';

type Input = Parameters<typeof checkOrigin>[0];

function check(overrides: Partial<Omit<Input, 'headers'>> & { headers?: Record<string, string> } = {}) {
  const { headers, ...rest } = overrides;
  return checkOrigin({
    method: 'POST',
    pathname: '/api/customers',
    protocol: 'http',
    headers: new Headers({ host: 'localhost:3100', cookie: '__Host-cbs_demo=nexio-admin', origin: 'http://localhost:3100', ...headers }),
    credentials: 'cookie',
    ...rest,
  });
}

describe('checkOrigin', () => {
  it('lets a same-origin cookie POST through', () => {
    expect(check()).toEqual({ ok: true });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects a cookie %s with a foreign Origin', (method) => {
    expect(check({ method, headers: { origin: 'https://evil.example' } })).toEqual({ ok: false });
  });

  it('rejects a cookie POST with no Origin', () => {
    const headers = new Headers({ host: 'localhost:3100', cookie: 'a=b' });
    expect(checkOrigin({ method: 'POST', pathname: '/api/customers', protocol: 'http', headers, credentials: 'cookie' })).toEqual({ ok: false });
  });

  it.each(['null', '', 'not a url', 'http://localhost:3100.evil.example', 'http://evil.example@localhost:3100'])('rejects the Origin %j', (origin) => {
    expect(check({ headers: { origin } })).toEqual({ ok: false });
  });

  it('rejects the same host on another port and another scheme', () => {
    expect(check({ headers: { origin: 'http://localhost:3101' } })).toEqual({ ok: false });
    expect(check({ headers: { origin: 'https://localhost:3100' } })).toEqual({ ok: false });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not check %s', (method) => {
    expect(check({ method, headers: { origin: 'https://evil.example' } })).toEqual({ ok: true });
  });

  it('does not check paths outside /api', () => {
    expect(check({ pathname: '/dashboard', headers: { origin: 'https://evil.example' } })).toEqual({ ok: true });
  });

  it('does not check a POST that carries no cookie in demo mode, where the cookie is the credential', () => {
    const headers = new Headers({ host: 'localhost:3100', 'content-type': 'application/json' });
    expect(checkOrigin({ method: 'POST', pathname: '/api/auth/demo-login', protocol: 'http', headers, credentials: 'cookie' })).toEqual({ ok: true });
  });

  it('checks every POST in authelia mode, because the credential is a header and a proxy may drop the cookie', () => {
    const headers = new Headers({ host: 'billing.example.com', origin: 'https://evil.example' });
    expect(checkOrigin({ method: 'POST', pathname: '/api/customers', protocol: 'https', headers, credentials: 'proxy-headers' })).toEqual({ ok: false });
  });

  describe('bearer requests to /api/v1/*', () => {
    const bearer = { authorization: 'Bearer cbs_abc_secret' };
    const noCookie = (extra: Record<string, string> = {}) => new Headers({ host: 'localhost:3100', ...bearer, ...extra });

    it('pass with no cookie and no Origin', () => {
      expect(checkOrigin({ method: 'POST', pathname: '/api/v1/invoices', protocol: 'http', headers: noCookie(), credentials: 'cookie' })).toEqual({ ok: true });
      expect(checkOrigin({ method: 'POST', pathname: '/api/v1/invoices', protocol: 'https', headers: noCookie(), credentials: 'proxy-headers' })).toEqual({ ok: true });
    });

    it('pass even when a stray cookie rides along, since the cookie grants nothing there', () => {
      expect(checkOrigin({ method: 'POST', pathname: '/api/v1/invoices', protocol: 'http', headers: noCookie({ cookie: 'a=b' }), credentials: 'cookie' })).toEqual({ ok: true });
    });

    it('do not pass on a non-v1 path', () => {
      expect(checkOrigin({ method: 'POST', pathname: '/api/customers', protocol: 'http', headers: noCookie({ cookie: 'a=b' }), credentials: 'cookie' })).toEqual({ ok: false });
    });

    it('do not pass without a bearer scheme', () => {
      expect(checkOrigin({ method: 'POST', pathname: '/api/v1/invoices', protocol: 'http', headers: noCookie({ authorization: 'Basic abc', cookie: 'a=b' }), credentials: 'cookie' })).toEqual({ ok: false });
    });

    it('do not pass on a look-alike path', () => {
      expect(checkOrigin({ method: 'POST', pathname: '/api/v10/invoices', protocol: 'http', headers: noCookie({ cookie: 'a=b' }), credentials: 'cookie' })).toEqual({ ok: false });
    });
  });

  describe('behind a TLS-terminating proxy', () => {
    it('compares the Origin with the Host and the forwarded scheme', () => {
      const headers = new Headers({ host: 'billing.example.com', 'x-forwarded-proto': 'https', cookie: 'a=b', origin: 'https://billing.example.com' });
      expect(checkOrigin({ method: 'POST', pathname: '/api/customers', protocol: 'http', headers, credentials: 'cookie' })).toEqual({ ok: true });
      headers.set('origin', 'http://billing.example.com');
      expect(checkOrigin({ method: 'POST', pathname: '/api/customers', protocol: 'http', headers, credentials: 'cookie' })).toEqual({ ok: false });
    });

    it('fails closed when the proxy sent no scheme and the app sees plain http', () => {
      const headers = new Headers({ host: 'billing.example.com', cookie: 'a=b', origin: 'https://billing.example.com' });
      expect(checkOrigin({ method: 'POST', pathname: '/api/customers', protocol: 'http', headers, credentials: 'cookie' })).toEqual({ ok: false });
    });

    it('uses the configured public origin, exactly, instead of Host when one is set', () => {
      const headers = new Headers({ host: 'app:3000', cookie: 'a=b', origin: 'https://billing.example.com' });
      const input = { method: 'POST', pathname: '/api/customers', protocol: 'http', headers, credentials: 'cookie', publicOrigin: 'https://billing.example.com' } as const;
      expect(checkOrigin(input)).toEqual({ ok: true });
      headers.set('origin', 'http://app:3000');
      expect(checkOrigin(input)).toEqual({ ok: false });
    });
  });
});
