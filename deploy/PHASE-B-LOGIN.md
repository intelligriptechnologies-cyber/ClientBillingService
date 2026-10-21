# Independent Client Billing login on Hetzner

Production-named and staging-named development installations use `CLIENT_BILLING_AUTH_MODE=password`.
`CBS_PUBLIC_ORIGIN` must be the exact HTTPS origin. Each environment retains its own `CBS_PROXY_SECRET`
and database connections. Caddy overwrites the proxy-secret and client-IP headers and strips forwarded identity
headers. The application ignores Authelia identity headers in password mode. Public demo login is not enabled.

Credentials are provisioned as separate `deploy/auth/production.json` and `deploy/auth/staging.json` files.
They are not committed. The activation package creates root-owned files, group 1000, mode 0440, in a restricted
directory, with individual read-only mounts at `/run/cbs-auth/users.json`. Existing authorized tester usernames,
Argon2id hashes and disabled status are preserved. Production keeps its existing superadmin-only access list;
staging keeps its existing authorized tester list. Tenant memberships and roles remain in the existing database.
Do not provision demo identities or plaintext passwords. Privileged operators must manage these files separately
after migration; editing the old Authelia users file no longer updates native accounts.

Sessions are opaque random tokens, held in memory by the single app process, with eight-hour absolute expiry.
Cookies are Secure, HttpOnly, SameSite=Lax and host-only. App restarts log users out. Logout, account disabling,
password changes and credential-file role changes revoke access. Database membership status is checked on
requests. Login throttling is per account and trusted client IP; its in-memory counters reset on restart.

Phase B activation uses a reviewed, checksum-pinned package installed in a root-owned directory. It updates only
the two Client Billing app containers, their environment authentication settings, deployment source and imported
Caddy routes. It does not run `deploy-remote.sh`, migrations, seeds or database recovery. Shared Caddy is reloaded
gracefully; its main file, CoWork gateway and unrelated containers are preserved. Authelia and its portal routes
remain available until a separate retirement review after successful real-user login acceptance.

The package writes the reviewed source changes into the existing checkout and updates both existing app image
tags to the pinned candidate. Preserve and merge these source changes into the deployment branch before a later
GitHub deployment; do not discard the checkout changes or deploy an older authentication implementation.
No workflow triggers or branch settings are changed by this migration.
