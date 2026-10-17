# 0002. Real login with server-side sessions, and demo mode as a login method

- Status: Proposed
- Date: 2026-10-17
- Issue: #34 (matrix row `auth`). Also covers row `audit`, and fixes the seam for rows `api` and `check-api`.
- Depends on: [0001](0001-postgres-store.md). The auth tables are Postgres migrations, not SQLite tables.

## Decision

1. **Sessions are opaque and stored server-side in Postgres.** The cookie `__Host-cbs_session` holds 32 random bytes in base64url. The `sessions` table stores only the SHA-256 of that value, so a database leak does not hand out live sessions. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`, with no `Domain`. Its `Max-Age` is the absolute lifetime.
2. **Sessions expire, rotate and revoke on the server.** An idle timeout is enforced from `last_seen_at`, and route handlers bump that column at most once every 5 minutes. Every login and every password set issues a new token. Logout deletes the row. A change to a user's role, status or password deletes all of that user's other sessions. The proposed defaults are a 12-hour idle timeout and a 7-day absolute lifetime (owner question).
3. **Passwords are hashed with Argon2id from `node:crypto`.** This needs Node 24.7 or later, so the `Dockerfile` and CI move from Node 22 to Node 24 LTS. The parameters are the OWASP minimum (`m=19456` KiB, `t=2`, `p=1`), stored as a PHC string. Verification uses `timingSafeEqual`, and a hash is redone at login when the parameters change. If the Node 24 move is blocked, use `@node-rs/argon2` 2.x instead. It runs on Node 22 and is already in Next's default `serverExternalPackages` list.
4. **Demo mode is a login method, not a second session system.** `CLIENT_BILLING_AUTH_MODE` is `password` or `demo`. In demo mode the identity picker logs in without a password, but it creates the same `sessions` row. Every route then reads one session format. `GET /api/auth/identities` returns 404 unless the mode is `demo`.
5. **Demo mode cannot start in production.** The guard reads a new `CLIENT_BILLING_ENV` (`local`, `demo`, `staging` or `production`), not `NODE_ENV`, because the Docker image sets `NODE_ENV=production` for staging too. The `register()` hook in `instrumentation.ts` throws when `CLIENT_BILLING_ENV=production` and the mode is `demo`, so the container fails its health check and the deploy aborts.
6. **CSRF protection is `SameSite=Lax` plus an `Origin` check in `proxy.ts`.** A `POST`, `PUT`, `PATCH` or `DELETE` to `/api/*` that carries the session cookie must send an `Origin` listed in `APP_ORIGINS`. Otherwise it gets a 403. Requests with a bearer token on `/api/v1/*` skip the check, because those routes never read cookies. `GET` handlers stay read-only.
7. **Rate limits and lockout live in Postgres.** The `login_attempts` table holds attempts per email and per client IP. Five failures for one email in 15 minutes lock that email for 15 minutes. Fifty failures from one IP in 15 minutes block that IP. Both return 429 with `Retry-After` and the same generic message. An unknown email still runs one hash, so response time does not reveal which emails exist. The app reads the client IP from `X-Forwarded-For` only when `TRUST_PROXY=caddy`. Nothing locks an account permanently.
8. **No account has a default password.** `npm run auth:bootstrap -- --email <address>` creates the first superadmin and prints a one-time set-password link. Creating a tenant creates an invite link for its first admin, not the `admin123` users that `createTenant` makes today. A tenant admin invites users and issues reset links. Links are single-use and stored as hashes. Invite links last 24 hours and reset links last 1 hour. Self-serve reset by email waits for row `email`.
9. **Every request resolves to a typed principal.** `Actor` is a union: `{ kind: 'user' }`, `{ kind: 'apiToken' }` or `{ kind: 'system' }`. Store methods take `TenantContext = { tenantId, actor }` (ADR 0001, D5). A superadmin is a user with `tenant_id` null and role `superadmin`. A superadmin can call platform operations only and can never hold a `TenantContext`.
10. **API tokens for client ERPs fit this design without changing it.** The `api_tokens` table holds `tenant_id`, an optional `customer_id`, `scopes`, `secret_hash`, `last_used_at`, `expires_at` and `revoked_at`. The token format is `cbs_<id>_<secret>`, and the secret is shown once. Only `/api/v1/*` accepts it, as `Authorization: Bearer`. A token resolves to a `TenantContext` with an `apiToken` actor, so RLS and the store treat it like any other principal. The table is built when row `api` starts. This ADR fixes only its shape.
11. **The audit trail is one append-only table.** Each `audit_events` row has `tenant_id`, `actor_kind`, `actor_id`, `action`, `entity_type`, `entity_id`, `reason`, `before` and `after` as `jsonb`, `request_id`, `ip` and `occurred_at`. The row is written in the same transaction as the change it records. `cbs_app` gets `INSERT` and `SELECT` only. The table replaces `contract_audit_events`, `tenant_lifecycle_events` and the `feature-flow` rows in `operational_logs`. Login successes and failures, logouts, password sets and token changes are audit events too.
12. **Plain-text passwords are discarded, not hashed.** All 11 users in `seed/initial-data.sqlite` have the password `admin123`, which `src/components/demo-login.tsx` prints on the login page. Hashing a published password keeps it working. The import in ADR 0001 (D10) sets `password_hash` to null, and the auth migration drops the `password` column. Each real user gets a set-password link.
13. **Emails are unique per tenant.** The key is `UNIQUE (tenant_id, lower(email))`, plus a partial unique index for platform users. At login the app finds every account with that email through `withPlatform`, verifies the password against each one, and logs in when exactly one matches. When more than one matches, it shows a tenant choice, but only after the password check passes. This closes the two `it.fails` email leaks in `src/lib/tenant-isolation.test.ts` (owner question).

## Context

- `src/lib/session.ts` reads the cookie `client-billing-demo-session`, whose value is the raw user id, and passes it to `authenticate(userId)`. Anyone who knows or guesses an id such as `nexio-admin` is that user.
- `POST /api/auth/login` takes `{ userId }` and no password. `GET /api/auth/identities` lists every active user with email and role, with no authentication.
- `users.password` holds plain text. `createTenant` and `createTenantUser` in `src/lib/store/tenants.ts` hardcode `admin123`.
- `users.email` is globally `UNIQUE`. Two tests in `src/lib/tenant-isolation.test.ts` are marked `it.fails` because adding or renaming a user to another tenant's email is refused, which reveals that the email exists.
- The app writes through Route Handlers called with JSON `fetch`, not Server Actions. Next's guide says Server Actions compare `Origin` with `Host`. It describes no such check for Route Handlers (`node_modules/next/dist/docs/01-app/02-guides/data-security.md`). Server Components can read cookies but cannot set them (`.../04-functions/cookies.md`). In Next 16, `proxy.ts` replaces `middleware.ts` and runs on the Node runtime (`.../03-file-conventions/proxy.md`).
- nexio_stock issues HS256 JWTs and hashes with bcrypt. cwerp uses `jsonwebtoken` and `bcrypt`. The matrix suggests reusing a pattern from servez or PrepVault, but neither repo is on this machine, so this ADR could not inspect them.

### Facts checked for this ADR

| Claim | How it was checked |
| --- | --- |
| `crypto.argon2` was added in Node v24.7.0 and takes `message`, `nonce`, `parallelism`, `tagLength`, `memory` and `passes`. No experimental marker appears in its section | `doc/api/crypto.md` on the `v24.x` and `main` branches |
| `crypto.argon2` is undefined on the `node:22-bookworm-slim` image (v22.23.3) and present on local Node v24.11.1 | Ran both |
| `crypto.argon2Sync` reproduces the RFC 9106 Argon2id test vector (`0d640df5...6b01e659`). At `m=19456`, `t=2`, `p=1` one hash takes about 49 ms on the development laptop | Ran on Node v24.11.1, mean of 20 hashes. The Hetzner box is not measured |
| OWASP minimum for Argon2id is 19 MiB, 2 iterations and parallelism 1 | OWASP Password Storage Cheat Sheet |
| Chromium sends a `__Host-` cookie with `Secure` over `http://localhost` and `http://127.0.0.1`, so Playwright e2e can use the production cookie name | Probe with the repo's Playwright Chromium |
| `better-auth` 1.7.10, `jose` 6.2.12, `@node-rs/argon2` 2.2.2 and `argon2` 0.45.1 are current. `@node-rs/argon2` and `argon2` are in Next's default `serverExternalPackages` | `npm view`, 2026-10-17, and `server-external-packages.jsonc` |
| Better Auth hashes with scrypt by default, keeps passwords in its `account` table, keeps its rate-limit counters in memory by default, and uses the session `token` column as the cookie value | Context7, `/better-auth/better-auth` |

## Options considered

The arena ran as one labelled sequential pass in this session. No cross-judge ran.

### Rubric

1. **Revocation and expiry.** Can a stolen or stale session be killed at once, and do idle and absolute limits hold?
2. **Fit with the tenant model.** Does it work with `tenant_id` on users, the platform role, RLS context and demo mode?
3. **API-token path.** Can rows `api` and `check-api` add machine principals without reworking sessions?
4. **Code to own.** How much security-critical code and schema does this repo maintain, and how much of it is someone else's moving target?
5. **Team familiarity.** How close is it to what nexio_stock and cwerp already run?

### Candidates

- **A. Opaque database sessions, built in this repo on `node:crypto`.**
- **B. Stateless signed cookie.** A JWT signed with `jose`, as in Next's authentication guide and the team's other apps. A `session_version` column on `users` handles revocation.
- **C. Better Auth 1.7.** Its email and password provider, its `pg` adapter and its API-key plugin, with tenant and role added as extra user fields.
- **D. Keep the picker and put each environment behind Caddy basic auth.** This is the premise attack. Maybe the real need is only "strangers cannot get in".

| Criterion | A | B | C | D |
| --- | --- | --- | --- | --- |
| Revocation and expiry | Delete the row. Takes effect on the next request | Needs a `users` read on every request to check `session_version`, which removes the stateless benefit | Built in | No per-user sessions |
| Tenant model fit | Tables and RLS from ADR 0001, one session format for both login methods | Tenant and role live inside the token and go stale until it expires | Second schema owner (`user`, `session`, `account`, `verification`) next to ours. Tenant and role become plugin fields | No user identity, so no audit actor |
| API-token path | `api_tokens` resolves to the same `TenantContext` | Separate bearer path still needed | API-key plugin is user-owned. Tokens for a tenant's customer do not match that model | None |
| Code to own | A few hundred lines (estimate) on standard primitives, no new dependency on Node 24 | Same size plus key rotation | Least code, but frequent releases (1.7.10 shipped 2026-10-15) and its own migration CLI | Almost none |
| Team familiarity | New pattern for the team | Matches nexio_stock and cwerp | New library | Known Caddy feature |

### Recommendation

Pick A. Revocation is the deciding criterion for a billing app, because a disabled accountant must lose access on their next click. B can do that only by reading the database on every request. Once it does, it is A with a signed blob in the cookie. C would give 2FA, passkeys and OAuth later. It would also bring a second set of user tables and a second migration tool into a schema that ADR 0001 builds around RLS. Its key model is user-owned, which does not fit tokens issued to a tenant's ERP customer. D answers a smaller question than row `auth` asks.

Grafts from the other candidates:

- From C, keep `ip_address` and `user_agent` on each session row. A later "signed-in devices" list and the audit trail can then show them. Rate-limit rules are also written as a table of path, window and maximum, not as scattered `if` blocks.
- From D, a public demo environment can sit behind Caddy basic auth, so search engines and strangers do not wander into the sales demo. This needs no app code.
- From B, nothing is taken. Tokens in cookies are the part this decision rejects.

### What would change this decision

- If the owner wants SSO, OAuth sign-in or passkeys for tenant users within two quarters, Better Auth's plugins outweigh its schema cost. Re-run this comparison with C as the base.
- If session lookup becomes a measurable share of request time, add a short in-process cache keyed by token hash. Revocation would then wait for the cache to expire, so cap it at 30 seconds. Nobody has measured this. The lookup is one indexed primary-key read.
- If Node 24 cannot ship, use `@node-rs/argon2` with the same parameters and PHC strings. Stored hashes stay compatible.

## Consequences

- Units that touch no storage (A1, A2, A3) can land before the Postgres switch. The rest wait for ADR 0001 unit D11, so no auth table is built on SQLite and then ported.
- `getCurrentSession()` becomes `getPrincipal(request)`. The page layouts in `src/app/(app)/layout.tsx` and `src/app/page.tsx` read it but never refresh the cookie, because Server Components cannot set cookies. Only route handlers bump `last_seen_at`.
- The demo picker keeps its current look and behavior in demo mode. Its `admin123` hint goes away, because password mode never shows the picker.
- `seed/initial-data.sqlite` users arrive with no usable password. Before production use, the owner runs `auth:bootstrap` and sends set-password links.
- Once audit lands, the logs page and the tenant history panel read `audit_events`. `operational_logs` keeps only `error` rows.

## Implementation plan

Each unit lands alone and keeps lint, typecheck, Vitest and Playwright green. A1 to A3 can land any time. A4 needs ADR 0001 D11. A5 to A8 need A4. A9 waits for row `api`.

1. **A1. Add the auth config and principal types.** `src/lib/auth/config.ts` parses `CLIENT_BILLING_ENV` and `CLIENT_BILLING_AUTH_MODE` once. `instrumentation.ts` calls it from `register()`. `src/lib/auth/principal.ts` defines `Actor` and `TenantContext`. `/api/auth/identities` returns 404 outside demo mode.
   - **Check.** A table test covers every env and mode pair, and `production` with `demo` throws. `e2e/soft-login.spec.ts` passes unchanged in demo mode.
2. **A2. Add the `Origin` check in `proxy.ts`.**
   - **Check.** A Vitest test calls the proxy function directly. A cookie `POST` with a foreign `Origin` gets 403. A cookie `POST` with no `Origin` gets 403. A same-origin `POST` passes. A bearer `POST` with no cookie passes. All e2e specs pass.
3. **A3. Move to Node 24 and add the password module.** Update the `Dockerfile` base images, `node-version` in `ci.yml`, and `engines` in `package.json`. `src/lib/auth/password.ts` exports `hashPassword`, `verifyPassword` and `needsRehash`.
   - **Check.** The RFC 9106 Argon2id test vector, which uses secret and associated data, matches through `crypto.argon2`. Hash and verify round-trips. A wrong password and an edited PHC string both fail. `needsRehash` is true for a hash with lower `m`. `docker build` succeeds on the new base.
4. **A4. Write the auth schema migration.** `db/migrations/0002_auth.sql` adds `users.password_hash` (null means the user must set a password), drops `users.password`, replaces the global email key with the per-tenant key, and adds `sessions`, `login_attempts` and `auth_tokens` (invite and reset). It grants these tables to `cbs_platform` only.
   - **Check.** The D3 isolation catalog test still passes. The two `it.fails` email-leak tests in `tenant-isolation.test.ts` become plain `it` and pass.
5. **A5. Add password login and sessions.** Add `src/lib/auth/session.ts`, a password form shown when the mode is `password`, and new `login` and `logout` routes. The demo picker now creates session rows. Delete `authenticate(userId)`, the `client-billing-demo-session` cookie and the `userId` login body.
   - **Check.** `src/lib/auth/session.test.ts` covers expired, idle, revoked and rotated sessions, and a role change killing other sessions. A route test asserts the exact `Set-Cookie` attributes. The new `e2e/password-login.spec.ts` runs in a Playwright project whose web server has `CLIENT_BILLING_AUTH_MODE=password`. The soft-login spec still passes in demo mode. Then point row `auth` at `src/lib/auth/session.test.ts`, set it to `built`, and close #34.
6. **A6. Add rate limits and lockout.**
   - **Check.** The sixth failure for one email inside 15 minutes returns 429 with `Retry-After`. A success clears the email's count. A login with an unknown email still calls `verifyPassword` once. Without `TRUST_PROXY`, the IP check ignores a spoofed `X-Forwarded-For`.
7. **A7. Add bootstrap, invites and admin-issued resets.** Add the `auth:bootstrap` script and the set-password page. Remove the `admin123` literals from `src/lib/store/tenants.ts`.
   - **Check.** A link works once and fails the second time. An expired link fails. Setting a password ends the user's other sessions. `e2e/tenants.spec.ts` creates a tenant and opens its invite link.
8. **A8. Add the audit trail.** Add `audit_events`, write it inside every money mutation (issue, correct and void invoice, record and edit payment, close pending, contract and plan changes) and every auth event. Move the logs page and tenant history to the new table, then drop `contract_audit_events` and `tenant_lifecycle_events`.
   - **Check.** Each money mutation writes exactly one audit row. A mutation that fails writes none. `UPDATE` and `DELETE` on `audit_events` as `cbs_app` fail with `42501`. Row `audit` moves to `built`.
9. **A9. Add API tokens when row `api` starts.** Create `api_tokens`, the `/api/v1/*` bearer resolver and a token admin screen.
   - **Check.** A token reads only its own tenant under RLS. A revoked or expired token gets 401. A session cookie sent to `/api/v1/*` is ignored. The database holds only the hash of the secret.

## Needs owner decision

1. **Where demo mode runs.** Recommended default. Locally, and later in a dedicated `demo` environment behind Caddy basic auth. Staging runs `password` mode so it rehearses production.
2. **One email in several tenants.** Should one person, such as an accountant, be able to hold accounts in two tenants with the same email? Recommended default. Yes. Keep emails unique per tenant and offer the tenant choice after the password check. This also closes the two known email leaks.
3. **Password reset before email ships.** Recommended default. Links issued by an admin. A tenant admin resets users, the superadmin resets tenant admins, and `auth:bootstrap` resets the superadmin. Switch to self-serve email reset when row `email` lands.
4. **Session lifetimes.** Recommended default. A 12-hour idle timeout and a 7-day absolute lifetime.
5. **Two-factor sign-in for the superadmin.** Recommended default. Add TOTP for the superadmin before the first paying tenant goes live. It is optional for tenant users and can come later.
6. **Superadmin access to tenant billing data.** Recommended default. None, as today. If support needs it, add a time-boxed support session that writes audit events and that the tenant can see.
7. **servez and PrepVault.** Row `auth` says to reuse their pattern, but this ADR could not read them. Recommended default. Go ahead with this design. Point to those repos if a specific part of them must be reused.
