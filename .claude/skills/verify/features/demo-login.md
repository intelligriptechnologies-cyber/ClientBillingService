# Demo login

Demo login lets a reviewer choose one of the seeded identities at `/` without a password, enter a tenant-scoped or platform workspace, and sign out. Operational routes are closed to signed-out visitors.

## Sub-features

- `login-picker` lists every seeded identity and enters the chosen one.
- `login-tenant-nav` shows tenant navigation (Master Data, Operational Records, Billing, Reports, and Admin Console for admins only).
- `login-superadmin-nav` shows only `Platform dashboard` and `Tenants`.
- `login-guard` redirects signed-out visitors and wrong-role visitors.
- `login-signout` ends the session.
- `login-mobile` keeps the picker usable at 360px.

## How to get to it (user POV)

- Open `/` signed out. The page heading is `Choose a demo identity`.
- Choose `Sign out` in the sidebar of any signed-in page.
- Open any operational route while signed out, for example `/invoices` or `/tenants`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true`.
- No saved session is needed. `control-billing login` with no argument lists the identities.

- **Picker lists identities.** Run `control-billing login`. The result lists 11 ids: `superadmin`, and `<tenant>-admin` and `<tenant>-user` for `nexio`, `maasp`, `evo`, `gripdata`, `od`.
- **Enter as tenant admin.** Run `control-billing login nexio-admin`. It selects `Demo identity`, clicks `Enter demo`, and lands on `/dashboard` with the heading `Nexio Hyper dashboard`. The evidence dir gets `login-nexio-admin.png`.
- **Tenant navigation.** Run `control-billing snapshot /dashboard --as nexio-admin`. The navigation named `Main navigation` has `Dashboard` and the buttons `Master Data`, `Operational Records`, `Billing`, `Reports`, `Admin Console`.
- **User role has no admin console.** Run `control-billing login nexio-user`, then `control-billing snapshot /dashboard --as nexio-user`. `Admin Console` is absent.
- **Superadmin navigation.** Run `control-billing login superadmin`, then `control-billing snapshot /dashboard --as superadmin`. The heading is `Platform dashboard`; the navigation holds the links `Platform dashboard` and `Tenants` and no `Customers` link.
- **Route guard, signed out.** Run `control-billing snapshot /invoices --anonymous`. The result has `redirected: true`, `finalPath: "/"` and the `Choose a demo identity` heading. Run `control-billing api GET /api/customers --anonymous`. The status is `401` with `A tenant session is required.`
- **Route guard, wrong role.** Run `control-billing snapshot /tenants --as nexio-admin`. The result has `redirected: true` and `finalPath: "/dashboard"`. Repeat with `/settings --as nexio-user` for the same result.
- **Sign out.** Run `control-billing run .claude/skills/verify/journeys/sign-out.mjs --as nexio-admin`. It clicks `Sign out`, the page returns to `/` with the `Choose a demo identity` heading, and a following visit to `/customers` bounces back to `/`. The result is `{ signedOut: true, bouncedTo: "/" }`.
- **Proof.** Save `control-billing snapshot /dashboard --as nexio-admin --out login/nexio-dashboard.aria.txt` and the `login-nexio-admin.png` screenshot. Both show `Nexio Hyper` and `Admin@nexio.com`.

## Gotchas

- Identity ids are lowercase (`nexio-admin`), but the visible option text is `Nexio Hyper — Admin@nexio.com (admin)`. Select by id.
- The cookie `__Host-cbs_demo` holds the bare user id, or `platform` for the superadmin entry. A request carrying a valid id is fully authenticated, which is intended for the demo.
- A disabled tenant's users are redirected to `/` on their next request, so a stale saved session fails with a redirect, not a 401 page.
- Users have no password column. The picker asks for none, and authelia mode leaves passwords to Authelia. Do not report their absence as a defect.
- `control-billing login` drives the real picker. `--no-browser` calls the login API and skips the picker, so do not use it as proof of the picker.
