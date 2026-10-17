import { describe, expect, it } from 'vitest';
import type { AutheliaAuthConfig } from './config';
import { hasValidProxySecret, parseForwardedIdentity, stripForwardedHeaders } from './forwarded';

const secret = 'proxy-secret-proxy-secret-proxy-s';
const config: AutheliaAuthConfig = { mode: 'authelia', env: 'staging', proxySecret: secret, memberGroup: 'cbs-users', superadminGroup: 'cbs-superadmin', logoutUrl: 'https://auth.example.com/logout' };

function headers(values: Record<string, string | undefined> = {}) {
  const result = new Headers();
  const merged = { 'x-cbs-proxy-secret': secret, 'remote-user': 'alice', 'remote-groups': 'cbs-users', 'remote-email': 'alice@example.com', 'remote-name': 'Alice A', ...values };
  for (const [name, value] of Object.entries(merged)) if (value !== undefined) result.set(name, value);
  return result;
}

describe('hasValidProxySecret', () => {
  it('accepts only the exact secret', () => {
    expect(hasValidProxySecret(headers(), secret)).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['same length but wrong', 'x'.repeat(secret.length)],
    ['shorter', secret.slice(1)],
    ['longer', `${secret}x`],
    ['a prefix of the right length plus a different tail', `${secret.slice(0, -1)}!`],
  ])('rejects a %s secret', (_label, value) => {
    expect(hasValidProxySecret(headers({ 'x-cbs-proxy-secret': value }), secret)).toBe(false);
  });
});

describe('parseForwardedIdentity', () => {
  it.each([
    ['a missing secret', { 'x-cbs-proxy-secret': undefined }],
    ['a same-length wrong secret', { 'x-cbs-proxy-secret': 'x'.repeat(secret.length) }],
    ['a different-length secret', { 'x-cbs-proxy-secret': 'short' }],
  ])('refuses %s with 401 even when the identity headers are valid', (_label, values) => {
    expect(parseForwardedIdentity(headers(values), config)).toMatchObject({ ok: false, status: 401 });
  });

  it('parses a member', () => {
    expect(parseForwardedIdentity(headers(), config)).toEqual({
      ok: true,
      access: 'member',
      identity: { username: 'alice', email: 'alice@example.com', name: 'Alice A', groups: ['cbs-users'] },
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['missing', undefined],
  ])('refuses a %s Remote-User with 401', (_label, value) => {
    expect(parseForwardedIdentity(headers({ 'remote-user': value }), config)).toMatchObject({ ok: false, status: 401 });
  });

  it.each(['Alice', 'ali ce', 'alice@example.com', 'al/ice', 'alice,bob', 'alice, bob', 'x'.repeat(65), 'ålice', '../alice'])('refuses the username %j', (username) => {
    expect(parseForwardedIdentity(headers({ 'remote-user': username }), config)).toMatchObject({ ok: false, status: 401 });
  });

  it.each(['a', 'alice', 'a.b_c-d', '0123', 'x'.repeat(64)])('accepts the username %j', (username) => {
    expect(parseForwardedIdentity(headers({ 'remote-user': username }), config)).toMatchObject({ ok: true });
  });

  it('parses Remote-Groups "cbs-users, other" into two trimmed groups', () => {
    const result = parseForwardedIdentity(headers({ 'remote-groups': 'cbs-users, other' }), config);
    expect(result).toMatchObject({ ok: true, identity: { groups: ['cbs-users', 'other'] } });
  });

  it('drops empty group entries', () => {
    const result = parseForwardedIdentity(headers({ 'remote-groups': ',cbs-users,, ' }), config);
    expect(result).toMatchObject({ ok: true, identity: { groups: ['cbs-users'] } });
  });

  it.each([
    ['no groups', ''],
    ['unrelated groups', 'dev,admin'],
    ['a group that only looks like the member group', 'CBS-USERS,cbs-users-extra'],
  ])('refuses %s with 403', (_label, groups) => {
    expect(parseForwardedIdentity(headers({ 'remote-groups': groups }), config)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a missing Remote-Groups header with 403', () => {
    expect(parseForwardedIdentity(headers({ 'remote-groups': undefined }), config)).toMatchObject({ ok: false, status: 403 });
  });

  it('resolves the superadmin group to platform, even alongside the member group', () => {
    expect(parseForwardedIdentity(headers({ 'remote-groups': 'cbs-superadmin' }), config)).toMatchObject({ ok: true, access: 'platform' });
    expect(parseForwardedIdentity(headers({ 'remote-groups': 'cbs-users,cbs-superadmin' }), config)).toMatchObject({ ok: true, access: 'platform' });
  });

  it('falls back to the username when Remote-Name is absent and keeps an absent email empty', () => {
    const result = parseForwardedIdentity(headers({ 'remote-name': undefined, 'remote-email': undefined }), config);
    expect(result).toMatchObject({ ok: true, identity: { name: 'alice', email: '' } });
  });

  it('ignores every other header, including look-alike identity headers', () => {
    const result = parseForwardedIdentity(headers({ 'remote-user': undefined, 'x-remote-user': 'bob', 'x-forwarded-user': 'bob', 'remote-usernames': 'bob', authorization: 'Bearer bob' }), config);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('does not put the secret or the identity in a refusal', () => {
    const result = parseForwardedIdentity(headers({ 'remote-user': 'Bad User' }), config);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('Bad User');
  });
});

describe('stripForwardedHeaders', () => {
  it('removes every Remote-* header in any case and keeps the rest', () => {
    const input = new Headers({ 'Remote-User': 'bob', 'REMOTE-GROUPS': 'cbs-superadmin', 'remote-email': 'b@example.com', 'Remote-Name': 'Bob', 'Remote-Anything': 'x', authorization: 'Bearer t', 'x-requested-with': 'XMLHttpRequest' });
    const output = stripForwardedHeaders(input);
    expect([...output.keys()].sort()).toEqual(['authorization', 'x-requested-with']);
    expect(input.get('remote-user')).toBe('bob');
  });
});
