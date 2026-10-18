import { createHash, timingSafeEqual } from 'node:crypto';
import type { AutheliaAuthConfig } from './config';

export const proxySecretHeader = 'x-cbs-proxy-secret';

export type ForwardedIdentity = { username: string; email: string; name: string; groups: string[] };
export type ForwardedAccess = 'platform' | 'member';
export type ForwardedResult =
  | { ok: true; identity: ForwardedIdentity; access: ForwardedAccess }
  | { ok: false; status: 401 | 403; reason: string };

const usernamePattern = /^[a-z0-9._-]{1,64}$/;
const digest = (value: string) => createHash('sha256').update(value).digest();

/** Hashing first gives timingSafeEqual equal-length inputs, so a wrong length leaks nothing either. */
export function hasValidProxySecret(headers: Headers, secret: string): boolean {
  const presented = headers.get(proxySecretHeader);
  if (!presented) return false;
  return timingSafeEqual(digest(presented), digest(secret));
}

/**
 * Reads only the secret and the three Remote-* headers the app trusts (ADR 0002, decisions 1, 3 and 6).
 * Anything else a caller sends is never looked at.
 */
export function parseForwardedIdentity(headers: Headers, config: AutheliaAuthConfig): ForwardedResult {
  if (!hasValidProxySecret(headers, config.proxySecret)) return { ok: false, status: 401, reason: 'Missing or invalid proxy credential.' };
  const username = headers.get('remote-user')?.trim() ?? '';
  if (!usernamePattern.test(username)) return { ok: false, status: 401, reason: 'No valid signed-in user was forwarded.' };
  const groups = (headers.get('remote-groups') ?? '').split(',').map((group) => group.trim()).filter(Boolean);
  const access: ForwardedAccess | null = groups.includes(config.superadminGroup) ? 'platform' : groups.includes(config.memberGroup) ? 'member' : null;
  if (!access) return { ok: false, status: 403, reason: 'The user is not in a group that may use this app.' };
  const email = headers.get('remote-email')?.trim() ?? '';
  const name = headers.get('remote-name')?.trim() || username;
  return { ok: true, access, identity: { username, email, name, groups } };
}

/** For routes that must never see a forwarded identity, such as the bearer-only /api/v1/*. */
export function stripForwardedHeaders(headers: Headers): Headers {
  const result = new Headers(headers);
  for (const name of [...result.keys()]) if (name.toLowerCase().startsWith('remote-')) result.delete(name);
  return result;
}
