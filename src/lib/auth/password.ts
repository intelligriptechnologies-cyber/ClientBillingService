import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { verify } from 'argon2';

export const sessionCookie = '__Host-cbs_session';
export const sessionSeconds = 8 * 60 * 60;
export type PasswordUser = { username: string; email: string; name: string; passwordHash: string; platform: boolean; disabled: boolean };
type Session = { username: string; fingerprint: string; expires: number };
type Bucket = { count: number; until: number };
type State = { sessions: Map<string, Session>; attempts: Map<string, Bucket>; verifying: number };
const globalState = globalThis as typeof globalThis & { cbsPasswordState?: State };
const state = globalState.cbsPasswordState ??= { sessions: new Map(), attempts: new Map(), verifying: 0 };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = (user: PasswordUser) => digest(JSON.stringify(user));

/** Operator-owned file, read on every request so disabling or changing credentials revokes sessions. */
export function readPasswordUsers(file: string): PasswordUser[] {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data) || data.length === 0 || data.length > 1000) throw new Error('Invalid credential file.');
  const names = new Set<string>();
  for (const user of data) {
    if (!user || typeof user !== 'object' || typeof user.username !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(user.username)
      || names.has(user.username) || typeof user.email !== 'string' || !user.email.includes('@')
      || typeof user.name !== 'string' || typeof user.passwordHash !== 'string' || !user.passwordHash.startsWith('$argon2id$')
      || typeof user.platform !== 'boolean' || typeof user.disabled !== 'boolean') throw new Error('Invalid credential file.');
    names.add(user.username);
  }
  return data as PasswordUser[];
}

function sweep(now: number) {
  for (const [key, value] of state.sessions) if (value.expires <= now) state.sessions.delete(key);
  for (const [key, value] of state.attempts) if (value.until <= now) state.attempts.delete(key);
}

/** The edge overwrites this header and the app requires its proxy secret before accepting requests. */
export function loginSource(headers: Headers): string {
  const value = headers.get('x-cbs-client-ip') ?? '';
  return isIP(value) ? value : 'unknown';
}

export async function passwordLogin(file: string, username: string, password: string, source: string, now = Date.now()): Promise<{ status: 200; token: string } | { status: 401 | 429 }> {
  sweep(now);
  const keys = [`source:${source}`, `user:${username}`];
  const limits = [60, 10];
  if (state.verifying >= 2 || state.attempts.size >= 10000 || state.sessions.size >= 10000
    || keys.some((key, i) => (state.attempts.get(key)?.count ?? 0) >= limits[i])) return { status: 429 };
  for (const key of keys) {
    const prior = state.attempts.get(key);
    state.attempts.set(key, { count: (prior?.count ?? 0) + 1, until: prior?.until ?? now + 15 * 60 * 1000 });
  }
  const users = readPasswordUsers(file);
  const user = users.find((candidate) => candidate.username === username);
  state.verifying++;
  let valid = false;
  try {
    // Unknown accounts perform the same expensive verification; errors fail closed.
    valid = await verify(user?.passwordHash ?? users[0].passwordHash, password);
  } catch { valid = false; }
  finally { state.verifying--; }
  if (!valid || !user || user.disabled) return { status: 401 };
  for (const key of keys) state.attempts.delete(key);
  const token = randomBytes(32).toString('base64url');
  state.sessions.set(digest(token), { username, fingerprint: fingerprint(user), expires: now + sessionSeconds * 1000 });
  return { status: 200, token };
}

function tokenFrom(headers: Headers): string | undefined {
  return (headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}

export function passwordIdentity(file: string, headers: Headers, now = Date.now()): PasswordUser | null {
  const token = tokenFrom(headers);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = state.sessions.get(digest(token));
  if (!session || session.expires <= now) { state.sessions.delete(digest(token)); return null; }
  const user = readPasswordUsers(file).find((candidate) => candidate.username === session.username);
  if (!user || user.disabled || fingerprint(user) !== session.fingerprint) { state.sessions.delete(digest(token)); return null; }
  return user;
}

export function revokePasswordSession(headers: Headers) {
  const token = tokenFrom(headers);
  if (token) state.sessions.delete(digest(token));
}
