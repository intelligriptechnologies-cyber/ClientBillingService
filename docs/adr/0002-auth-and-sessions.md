# 0002. Sign-in through Authelia forward-auth, with tenant membership kept in the app

- Status: Proposed. Revised on 2026-10-17 after the owner chose Authelia. The earlier draft built password login and sessions in this repo. That design is withdrawn.
- Date: 2026-10-17
- Issue: #34 (matrix row `auth`). Also covers row `audit`, and fixes the seam for rows `api` and `check-api`.
- Depends on: [0001](0001-postgres-store.md) for the `users` columns and the audit table.

## Decision

1. **Authelia signs people in. The app never sees a password.** Caddy calls Authelia's forward-auth endpoint (`/api/authz/forward-auth`) before each request to the app. When Authelia answers 200, Caddy copies `Remote-User`, `Remote-Groups`, `Remote-Email` and `Remote-Name` onto the request. The app trusts those headers, so a user signs in once at the Authelia portal and lands in the app already signed in. This is the mode cwerp's test site runs. cwerp, though, still asks for its own password behind Authelia. Trusting the headers so that users sign in only once is a step past cwerp, and it is owner question 1.
2. **The key is the Authelia username, not the email.** `users.authelia_username` links a `users` row to `Remote-User`. Each `users` row is one membership: one person in one tenant with one role. A person in two tenants has two rows with the same username. Roles (`admin`, `user`), status and tenant stay in the app database, because tenant admins manage them and Authelia's users file is edited by hand.
3. **Superadmin is an Authelia group.** A request whose `Remote-Groups` contains `CBS_AUTH_SUPERADMIN_GROUP` resolves to the platform principal. It never holds a `TenantContext`, and it has no `users` row. The same group drives an Authelia `two_factor` rule. The group that grants the power is therefore the group that forces TOTP. A superadmin who also works inside a tenant uses a second Authelia username.
4. **Every request resolves to one of four outcomes.** It runs once per request in `getPrincipal(request)`.
   - `platform`: the superadmin.
   - `member`: a `TenantContext` for the selected tenant.
   - `chooseTenant`: the person is active in more than one tenant and has not picked one yet.
   - `noAccess`: Authelia knows the person, but no active `users` row matches.

   The selected tenant is stored in the cookie `__Host-cbs_tenant`, which holds a tenant id. It is not a credential. Each request checks it against the person's active rows, so a forged value at most opens the tenant chooser. One active row selects its tenant automatically. A disabled row loses access on the next request, because nothing is cached.
5. **First arrival binds by email.** A tenant admin adds a user by email and role. The row's `authelia_username` stays null until that person first arrives through Authelia. The app then sets the username on every unbound active row whose `lower(email)` equals `Remote-Email`, and it writes an audit event. Only the operator writes emails into Authelia's users file, so `Remote-Email` is trusted.
6. **Three layers make the headers trustworthy.** A forged header must get past all three.
   1. *Network.* The app publishes no port. It joins one Docker network, `cbs-<env>-edge`, whose only other member is Caddy. Other apps' containers on the host cannot reach it.
   2. *Caddy strips first.* Every CBS site block runs `request_header -Remote-*` before `forward_auth`, including the routes that skip Authelia. Authelia's docs say Caddy drops fabricated headers by default. This ADR did not check that claim, so the explicit strip stays.
   3. *Shared secret.* Caddy adds `X-CBS-Proxy-Secret` on every proxied request. `proxy.ts` compares it with `timingSafeEqual` and returns 401 when it is missing or wrong. `/api/health` is the one exception, because the container health check calls it directly and it reads no tenant data.

   mTLS between Caddy and the app is not used. The hop never leaves the host, and the secret plus the network give the same "only Caddy can call the app" property without certificates to rotate.
7. **Access is granted by group, so other apps' users stop at the gate.** The CBS domains get `default_policy: deny`. The superadmin group gets `two_factor` and `CBS_AUTH_MEMBER_GROUP` gets `one_factor`. Group names differ per environment (`cbs-users`, `cbs-superadmin`, `cbs-staging-users`, `cbs-staging-superadmin`). The app checks the member group as well, so an access rule written wrongly does not admit a cwerp user.
8. **Machine routes skip Authelia.** ERP clients cannot use a login portal. Caddy sends `/api/v1/*` to the app without `forward_auth`, still strips `Remote-*`, and still adds the secret. Only bearer tokens are accepted there (decision 11).
9. **Sessions, lockout, 2FA and password reset belong to Authelia.** The accepted lifetimes (12-hour idle, 7-day absolute) become the CBS cookie's `inactivity: 12h` and `expiration: 7d`, with `remember_me` disabled. Lockout is Authelia's `regulation`. Password reset stays disabled until row `email` gives Authelia an SMTP notifier, as on cwerp's portal. Until then, the operator resets passwords with the provisioning script. To register TOTP, Authelia sends a one-time code through its notifier. With the filesystem notifier, the operator reads that code from the notifier file on the server.
10. **Logout ends both sessions.** `POST /api/auth/logout` clears `__Host-cbs_tenant` and returns the Authelia logout URL (`CBS_AUTHELIA_LOGOUT_URL`, for example `https://auth.<domain>/logout`). The client then navigates there. Whether Authelia honours an `rd` return address on `/logout` is not checked here.
11. **API tokens stay in the app, because Authelia has no tenant-scoped machine credentials.** The shape is unchanged from the first draft. `api_tokens` holds `tenant_id`, an optional `customer_id`, `scopes`, `secret_hash`, `last_used_at`, `expires_at` and `revoked_at`. The token format is `cbs_<id>_<secret>`, and only `/api/v1/*` accepts it as `Authorization: Bearer`. A token resolves to a `TenantContext` with an `apiToken` actor. `api_tokens` is in ADR 0001's pre-tenant allowlist.
12. **The audit trail stays one append-only table.** It records `actor_kind`, `actor_id` (`users.id`, a token id, or the Authelia username for the superadmin), `actor_username`, and the change itself. The trail covers money mutations, membership changes, first-arrival binding, tenant selection and token changes. Sign-in and sign-out events live in Authelia's log, not in the app.
13. **Demo mode stays, and the local password mode goes.** `CLIENT_BILLING_AUTH_MODE` is `authelia` or `demo`. In demo mode the identity picker sets `__Host-cbs_demo` to a `users.id`, and the same resolver produces the same four outcomes. `CLIENT_BILLING_ENV=production` with `demo` makes `register()` in `instrumentation.ts` exit, and the demo handlers refuse it too. No `password` mode exists, because Authelia already does passwords, lockout and 2FA. A second password system would be security code that has no user.
14. **CSRF protection is unchanged.** `SameSite=Lax` on Authelia's cookie, plus the `Origin` check in `proxy.ts` for cookie-bearing `POST`, `PUT`, `PATCH` and `DELETE` to `/api/*`. Bearer requests to `/api/v1/*` skip it.
15. **Expired sessions on `fetch` calls are handled in one place.** Authelia answers 401 when it detects an XHR, 302 for `GET`, and 303 otherwise. A cross-origin redirect to the portal makes `fetch` fail without a usable error. `src/lib/api-client.ts` sends `X-Requested-With: XMLHttpRequest` and uses `redirect: 'manual'`. On a 401 or an `opaqueredirect` it reloads the page, so Authelia's normal 302 sends the browser to the portal. That Authelia detects XHR from this header is an inference, so the wrapper handles both cases.

## Context

- **How cwerp uses Authelia.** No repository in the org holds the Authelia configuration. A sweep of every branch of `cwerp`, `nexio_stock`, `servez`, `PrepVault`, `workshop-os`, `sitegrid`, `nexios_garageflow` and `nexiohyper_website`, and of the upstream `Premdeepm/cwerp`, found no file named or containing `authelia`, `configuration.yml`, `users_database` or `Caddyfile.production`. `Cowork-Web`, `intelligrip-web` and `erp_master` are empty. The configuration lives only on the server, so the facts below come from the live site and from cwerp's app code.
- **The live test site.** A `GET https://test-erp.coworkvenue.in/` answers `302` to `https://auth.test-erp.coworkvenue.in/?rd=https%3A%2F%2Ftest-erp.coworkvenue.in%2F&rm=GET` with `Via: 1.1 Caddy`. That redirect matches the forward-auth response in Authelia's docs. `/api/health` is gated the same way. The response sets the session cookie `cowork_trial_session` for `domain=test-erp.coworkvenue.in`, `HttpOnly`, `Secure` and `SameSite=Lax`, with a 4-hour expiry. `https://auth.test-erp.coworkvenue.in/.well-known/openid-configuration` returns 404, so the OIDC provider is off. The portal page marks the build as Authelia's and sets `data-resetpassword="false"`, `data-rememberme="false"` and `data-passkeylogin="false"`.
- **cwerp's app ignores the headers.** At `payment_pgsql@8c8e2336f` and `nexio_multivendor@87181d43b`, `backend/src/services/auth.service.ts` checks a bcrypt hash (line 53 and line 52) and signs a JWT (lines 62 to 69). `backend/src/middleware/auth.middleware.ts` on `nexio_multivendor` accepts only `Authorization: Bearer` JWTs (lines 48 to 71). No downloaded cwerp auth file mentions `Remote-User`, `Remote-Groups` or `authelia`. cwerp's `docker-compose.yml` runs no Authelia, so local cwerp development has no gate. On cwerp, then, Authelia is a gate in front of a second login. This is inferred from the branches on GitHub. The commit deployed at `test-erp` is not known.
- **The shared host.** `test-erp.coworkvenue.in`, `auth.test-erp.coworkvenue.in` and `workshopos-staging.nexiohyper.com` all resolve to `89.167.40.86`. workshop-os's `docs/superpowers/specs/2026-09-22-workshopos-hetzner-staging-design.md` (lines 29 to 35 and 46 to 82, branch `prem-dev-fbb-backend`) names that box `nexiolabs`. There, Barstock's Caddy (`barstock-production-proxy-1`) binds ports 80 and 443 from `/opt/barstock/deploy/Caddyfile.production`. Other apps never bind 80 or 443. They join Caddy through an external Docker network. This repo's `deploy/docker-compose.yml` starts its own Caddy on 80 and 443, which would collide on that box.
- **This repo today.** `src/lib/session.ts` reads the cookie `client-billing-demo-session`, whose value is a raw user id. `POST /api/auth/login` takes `{ userId }` with no password. `users.password` is plain text, and `createTenant` hardcodes `admin123`. `users.email` is globally `UNIQUE`, which makes two `it.fails` email-leak tests in `src/lib/tenant-isolation.test.ts` fail.

### Facts checked for this ADR

| Claim | How it was checked |
| --- | --- |
| The test site redirects to the Authelia portal with `rd` and `rm`, through Caddy, and sets `cowork_trial_session` for 4 hours on its own domain | `curl -D -` with no redirects followed, 2026-10-17. No login was attempted |
| OIDC discovery on the cwerp Authelia returns 404 | The same `curl` |
| No org repo or branch contains Authelia configuration | Tree listings of every branch through `gh api`, grepped for the file names above |
| cwerp's backend reads only Bearer JWTs | Downloaded `auth.middleware.ts`, `auth.service.ts` and `routes/auth.ts` from two branches, and grepped them in full |
| The three hostnames share `89.167.40.86` | `Resolve-DnsName` |
| Authelia's Caddy integration is `forward_auth authelia:9091 { uri /api/authz/forward-auth; copy_headers Remote-User Remote-Groups Remote-Email Remote-Name }`. `Remote-Groups` is comma-separated (`admin,dev`). It answers 401 for a detected XHR, 302 for `GET` and `OPTIONS`, 303 otherwise, and 403 when denied | Authelia docs through Context7 (`integration/proxies/caddy.md`, `integration/proxies/introduction.md`, `integration/trusted-header-sso/introduction.md`) |
| Access rules are first-match, take `subject: group:<name>` and `policy: bypass, one_factor, two_factor or deny`, and `default_policy: deny` refuses anything unmatched | `configuration/security/access-control.md` and the architecture decision log, through Context7 |
| The file backend takes `watch` and `refresh_interval` (`always`, `disable` or a duration). Users carry `disabled`, `displayname`, `password` (argon2id), `email` and `groups`. `password_reset.disable` exists | `configuration/first-factor/file.md` and `introduction.md`, through Context7 |
| Session cookies are per domain, with `authelia_url`, `inactivity`, `expiration` and `remember_me` | `configuration/session/introduction.md`, through Context7 |
| Elevation one-time codes go through the notifier, and the filesystem notifier writes them to a file | `handler_session_elevation.go` and `file_notifier.go`, through Context7 |

## Options considered

The arena ran as one labelled sequential pass in this session. No cross-judge ran.

### Rubric

1. **One sign-in.** Does a user sign in once?
2. **Revocation.** Does a disabled membership lose access on its next request?
3. **Trust surface.** What does an attacker have to forge, and what stops them?
4. **Code to own.** How much security-critical code stays in this repo?
5. **Fit with the running Authelia.** Does it work with cwerp's instance as it is configured today?
6. **Machine path.** Can ERP clients reach `/api/v1/*`?

### Candidates

- **A. Forward-auth with trusted headers.** Authelia in front, and the app maps `Remote-User` to its memberships.
- **B. Authelia as an OIDC provider.** The app is an OIDC client, using a library such as `openid-client`. It handles the callback, PKCE and state, validates the ID token, and keeps its own `sessions` table.
- **C. Gate only, as cwerp runs today.** Authelia in front, and the first draft's password login and sessions behind it.
- **D. Separate Authelia instances per environment, shipped in this repo's Compose.** A deployment variant of A rather than a different app contract.

| Criterion | A | B | C | D |
| --- | --- | --- | --- | --- |
| One sign-in | Yes | Yes | No. Users sign in twice | Yes |
| Revocation | Membership read on every request | Same, plus the app session table | Same | Same as A |
| Trust surface | Headers. Covered by network, strip and secret | A signed token. No header trust needed | Two password systems | Same as A |
| Code to own | A header parser and a resolver | A callback flow, a session store and key handling | Everything from the first draft | A, plus a second Authelia to run, update and back up |
| Fit with running Authelia | A cookie entry and rules added to its config | The provider must be switched on and a client registered | Nothing to change | Leaves the shared config alone, but adds a container, storage and backups to run |
| Machine path | Caddy route that skips forward-auth | Same | Same | Same |

### Recommendation

Pick A, deployed into the existing Authelia (not D) if CBS shares the `nexiolabs` host. A is the only option that gives one sign-in without the app taking on a session store. Authelia already does lockout, TOTP, session expiry and password hashing. B buys freedom from header trust. Here the app is reachable only through Caddy, so the three layers in decision 6 cover that risk for less code. B also needs OIDC switched on in a shared configuration that this ADR cannot see. C keeps every line the owner's choice was meant to remove. D gives CBS a separate user list and a second auth server to patch. The owner asked for Authelia "the way cwerp does", which points at the instance already running.

Grafts:

- From B, the app never learns or stores a password, and principal resolution sits behind one function (`getPrincipal`). A later move to OIDC changes only that function and the Caddy block.
- From C, demo mode and its production guard stay.
- From D, the repo ships a complete standalone Authelia configuration for the smoke test (A5). If the owner picks another host, it becomes the production configuration with only values changed.

### What would change this decision

- If the app must be reachable without Caddy in front, for example by a native mobile client, switch to B. Only `getPrincipal` and the Caddy block change.
- If tenant admins must create sign-ins themselves, without the operator, put `lldap` behind Authelia's LDAP backend and let the app create users through it. The header contract stays the same.
- If CBS does not deploy to the shared host, use D with the smoke configuration.

## Consequences

- **Subtracted from the first draft.** The password module and the Node 24 move for Argon2 are gone, along with the `sessions`, `login_attempts` and `auth_tokens` tables, invite and reset links, `auth:bootstrap`, and the per-email and per-IP lockout. `users.password` is dropped and nothing replaces it. ADR 0001's pre-tenant allowlist shrinks to `tenants` and `api_tokens`.
- **Deploy changes.** Each bullet is described here and built in unit A5.
  - When CBS shares the host, `deploy/docker-compose.yml` drops its `caddy` service. Each app joins an external network, `cbs-staging-edge` or `cbs-production-edge`, and Barstock's Compose declares those networks for its Caddy, as workshop-os did.
  - `deploy/caddy/cbs.caddy` holds the CBS site blocks that the server's Caddyfile imports. Each block has the strip, `forward_auth`, the `/api/v1/*` route and the secret. It also rewrites Authelia's cookie to a dummy value on the hop to the app, as Authelia's Caddy guide shows. The block for the portal hostname (`auth.<cbs-domain>`) proxies to the Authelia container.
  - `deploy/authelia/cbs-session-cookies.yml` and `cbs-access-control.yml` are snippets the operator merges into the server's Authelia configuration.
  - `proxy.env.example` gains the per-environment proxy secrets. `.env.example` gains `CBS_PROXY_SECRET`, both group names and `CBS_AUTHELIA_LOGOUT_URL`.
- **Domains must not nest.** An Authelia cookie for `billing.example.com` is also sent to `staging.billing.example.com`. That would hand production sessions to staging. `proxy.env.example` uses exactly that pair today, so staging moves to a sibling name such as `billing-staging.example.com`.
- **Who creates sign-ins.** The superadmin adds a tenant and its first admin's email in the app. A tenant admin adds users by email. The operator then runs `deploy/authelia-user.sh add <username> <email> "<name>" <group>` over SSH. The script hashes a random password with `authelia crypto hash generate argon2` inside the Authelia container and edits the users file. It keeps a dated `.bak`, validates the file, and prints the password once for the operator to send. `disable` and `reset` work the same way. With `watch: true` and `refresh_interval: 1m`, Authelia picks up the change without a restart. The app never writes that file, because other apps share it. The superadmin console lists rows still waiting for an Authelia account.
- **Local development uses demo mode,** as cwerp runs no Authelia locally. Authelia mode is exercised in two places. A Playwright project starts the app in `authelia` mode and sends the secret and `Remote-*` headers through `extraHTTPHeaders`. The A5 smoke stack runs real Caddy and Authelia. Neither binds port 3000.
- **The identity source moves outside this repo.** Authelia's users file and its storage (TOTP secrets) now decide who can reach CBS. Their backup is not covered by ADR 0001's database dumps (owner question 2).
- **The seed's users** arrive with `authelia_username` null and bind on first arrival (ADR 0001, D10). The seed's `superadmin` row is not imported. The superadmin is a group member in Authelia.

## Implementation plan

Each unit lands alone and keeps lint, typecheck, Vitest and Playwright green. **A1 to A6 have no dependency on Postgres and can land now.** A7 and later need ADR 0001 D11.

1. **A1. Auth config and principal types.** `src/lib/auth/config.ts` parses `CLIENT_BILLING_ENV`, `CLIENT_BILLING_AUTH_MODE` (`authelia` or `demo`) and, in `authelia` mode, `CBS_PROXY_SECRET` (at least 32 bytes), both group names and the logout URL. `register()` exits on a refused config. `src/lib/auth/principal.ts` defines `Actor`, `TenantContext` and the `Resolution` union from decision 4. `/api/auth/identities` returns 404 outside demo mode.
   - **Check.** A table test covers every env and mode pair. `production` with `demo` is refused. `authelia` with no secret or a short secret is refused. A CI step runs `next start` on a port other than 3000 with `production` and `demo`, and asserts a non-zero exit. `e2e/soft-login.spec.ts` passes unchanged.
2. **A2. `Origin` check in `proxy.ts`.**
   - **Check.** A cookie `POST` with a foreign `Origin` or no `Origin` gets 403. A same-origin `POST` passes. A bearer `POST` to `/api/v1/*` with no cookie passes. All e2e specs pass.
3. **A3. Forwarded-identity parser and the secret gate.** `src/lib/auth/forwarded.ts` exports the pure function `parseForwardedIdentity(headers, config)`. It returns `{ username, email, name, groups }` or a refusal. `proxy.ts` enforces the secret in `authelia` mode and deletes `Remote-*` on `/api/v1/*`. `GET /api/auth/me` returns the parsed identity, for the smoke test.
   - **Check.** Table tests give these results.
     - A missing secret, a same-length wrong secret and a different-length secret each get 401, and `/api/health` still answers 200 without one.
     - An empty `Remote-User` gets 401.
     - A username outside `[a-z0-9._-]{1,64}` is refused.
     - `Remote-Groups: "cbs-users, other"` parses to two trimmed groups.
     - No member group and no superadmin group gets 403.
     - The superadmin group resolves to `platform`.
     - On `/api/v1/*`, a forged `Remote-User` never reaches the handler.
4. **A4. One fetch wrapper for expired sessions.** Every client `fetch` goes through `src/lib/api-client.ts` (decision 15).
   - **Check.** A unit test feeds the wrapper a 401 with `Location` and an `opaqueredirect`. Each calls the injected `reload` once, and a 200 does not. A lint rule (`no-restricted-globals` on `fetch` in `src/components` and `src/app`) leaves zero direct calls.
5. **A5. Deploy edge, Authelia snippets and the smoke stack.** Add the files listed under Consequences. `deploy/smoke/compose.yml` runs Caddy, a standalone Authelia (SQLite storage, filesystem notifier, a test users file) and the app in `authelia` mode, on a host port other than 3000. `deploy/smoke/run.sh` drives it with `curl`. It signs in through Authelia's first-factor API (`/api/firstfactor`, the endpoint the portal is expected to call; not checked here).
   - **Check.** `caddy validate` passes on the snippet imported into a stock Caddyfile. `authelia validate-config` passes on the smoke configuration and on the snippets merged into it. `run.sh` asserts each of the following.
     - An unauthenticated `GET /` gets 302 to the portal with `rd`.
     - After sign-in as `alice`, `/api/auth/me` returns `alice`.
     - An unauthenticated request carrying `Remote-User: admin` still gets 302.
     - Signed in as `alice`, a forged `Remote-User: bob` still yields `alice`.
     - `/api/v1/ping` reaches the app without Authelia, and a forged `Remote-User` there is absent.
     - A container on another network cannot connect to the app.
     - From the edge network, a request with no secret gets 401.
     - `docker compose port app 3000` prints nothing.

     A CI job runs the smoke test.
6. **A6. Operator provisioning script.** `deploy/authelia-user.sh` with `add`, `disable`, `reset` and `list`.
   - **Check.** Against the smoke stack, `add` creates a user who can sign in. `disable` makes that user's next sign-in fail. `reset` makes the old password fail and the new one work. A malformed edit is caught by validation and the `.bak` is restored. Running `add` twice for one username exits non-zero and leaves the file unchanged.
7. **A7. Memberships, binding and tenant selection.** Needs D11. ADR 0001's D3 baseline already carries `users.authelia_username`, per-tenant keys and no `password` column. `getPrincipal(request)` replaces `getCurrentSession()`. Add the chooser page `/select-tenant`, the tenant switcher in the menu, first-arrival binding, and logout through Authelia. Rewrite demo login onto `__Host-cbs_demo`. Delete `authenticate(userId)`, `client-billing-demo-session` and the `{ userId }` login body.
   - **Check.** `src/lib/auth/resolve.test.ts` covers every case below.
     - A person with one active row gets `member` with no chooser.
     - A person with two rows gets `chooseTenant`. Choosing sets the cookie. A forged tenant cookie for a tenant without a row returns to `chooseTenant`, with no 403 that would reveal the tenant.
     - Disabling one row removes that tenant on the next request and keeps the other.
     - First arrival binds every unbound row whose email matches, and writes one audit or operational row per binding.
     - A second person with the same email but a different username binds nothing.
     - The superadmin group gets `platform` and cannot reach a tenant route.
     - Demo mode resolves to the same outcomes.

     The two `it.fails` email tests become plain `it` and pass. The new `e2e/authelia-headers.spec.ts` passes in the Playwright project with `authelia` mode. Point row `auth` at `resolve.test.ts`, set it to `built`, and close #34.
8. **A8. In-app user provisioning.** `createTenant` takes the first admin's email instead of creating `admin123` users. Tenant admins add users by email and role. The superadmin console lists rows awaiting an Authelia account.
   - **Check.** Searching `src/` for `admin123` returns nothing. `e2e/tenants.spec.ts` creates a tenant with an admin email and sees it listed as awaiting an account.
9. **A9. Audit trail.** As in the first draft. Add `audit_events`, write it in the same transaction as every money mutation and every event in decision 12, move the logs page and tenant history to it, and drop `contract_audit_events` and `tenant_lifecycle_events` in a migration run as `cbs_owner`.
   - **Check.** Inside the migration, the copied count equals the source count, and a mismatch aborts it. Each money mutation writes exactly one row. A failed mutation writes none. `UPDATE` and `DELETE` as `cbs_app` fail with `42501`. Row `audit` moves to `built`.
10. **A10. API tokens when row `api` starts.** Create `api_tokens`, the `/api/v1/*` bearer resolver and a token admin screen.
    - **Check.** A token reads only its own tenant under RLS. A revoked or expired token gets 401. An Authelia cookie or `Remote-*` header sent to `/api/v1/*` grants nothing. The database holds only the hash of the secret.

## Owner decisions (accepted 2026-10-17)

The owner accepted every recommended default from the first draft. Each is restated in its Authelia form.

1. **Where demo mode runs.** Locally, and in a dedicated `demo` environment behind Caddy basic auth. Staging runs `authelia` mode.
2. **One email in several tenants.** Allowed. Emails are unique per tenant, and the person picks a tenant after sign-in (decision 4).
3. **Password reset before email ships.** The operator resets with `deploy/authelia-user.sh reset`. Authelia's self-service reset is switched on once row `email` provides SMTP.
4. **Session lifetimes.** A 12-hour idle timeout and a 7-day absolute lifetime, set on the CBS Authelia cookie.
5. **Two-factor for the superadmin.** TOTP is required for the superadmin through the `two_factor` rule before the first paying tenant. It is optional for tenant users.
6. **Superadmin access to tenant billing data.** None. A time-boxed, audited support session can come later.
7. **servez and PrepVault.** Their file trees and Compose files were read through `gh api`. Neither has an Authelia file or an auth service in Compose. Each signs its own tokens. servez has `backend/app/auth/` and `frontend/src/auth/jwt.ts`. PrepVault has `src/server/auth.ts` and a `session_version` migration. Authelia replaces that pattern here, so nothing from them is reused. Their auth code was not read line by line.

## Needs owner decision

1. **Trust the headers so users sign in once.** cwerp keeps its own login behind Authelia. Recommended default: trust `Remote-User`, as in decision 1. Choose C instead only if a second password inside the app is wanted on purpose.
2. **Host and Authelia instance.** Does CBS deploy to `nexiolabs` (`89.167.40.86`) and join its Caddy and Authelia? Recommended default: yes. The operator then needs to supply four things.
   - The paths to the Authelia configuration and users file.
   - The Authelia version, which must be 4.38 or later for per-domain cookies. The `rm` parameter suggests it is.
   - Its session and storage backends.
   - Whether its users file and storage are backed up anywhere today.
3. **Real domains.** Recommended default: a production domain and a sibling staging domain that is not under it. Each gets an `auth.` subdomain for the portal.
4. **Who provisions sign-ins, and how fast.** Recommended default: whoever holds SSH to the host runs `authelia-user.sh` when the console shows a waiting row. Move to `lldap` once tenant admins need to add users without waiting for the operator.
