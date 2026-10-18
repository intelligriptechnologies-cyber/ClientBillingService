---
name: verify
description: Drive and prove behavior of Client Billing Service (Ledgerly), the multi-tenant Next.js 16 billing web app (invoices, payments, contracts, GST reports, tenants), in an isolated instance with a fresh demo database. Use when you must show a UI or API change works in the real app, reproduce a bug, or capture screenshots, ARIA snapshots and database rows as evidence. Never use it against the owner's dev server on port 3000.
---

# Verify Client Billing Service

You drive the app through one CLI, `control-billing.mjs`, next to this file. Run it instead of improvising with curl, ad hoc Playwright scripts or `next dev`. Every subcommand prints one JSON object on stdout and exits 0 on success or 1 on failure. Errors say what to do next.

```
node .claude/skills/verify/control-billing.mjs --help
node .claude/skills/verify/control-billing.mjs <command> --help
```

Run it from the repo root (or any directory, paths resolve from the script). Node 22.13 or newer is required for `node:sqlite`. The shorthand `cb` below means `node .claude/skills/verify/control-billing.mjs`.

## Hard rules

- Never touch port 3000 or 3100, and never signal a process you did not start. `up` records what it starts in `.state/<name>.json`. `down` kills only that tree.
- Never kill by process name. Never run `next dev` in the checkout for verification.
- Read `node_modules/next/dist/docs/` (the repo's AGENTS.md says Next 16 differs from your training data) before changing Next-specific code. This skill only launches and drives; it never edits `src/`.
- Prove behavior on the surface a user touches (the browser, or the HTTP API the browser calls). Do not call store functions, edit the sqlite file, or add test-only endpoints.

## Launch

```
cb up                       # measured: about 15s with dependencies cached, about 1s more when the build is reused; first run adds npm ci (about a minute)
```

What `up` does, and why:

1. Copies `src/`, `public/`, `seed/` and the Next config of the **current working tree** (uncommitted edits included) into a private workspace under `%TEMP%/client-billing-verify/deps-<package-lock hash>/instances/<checkout hash>-<name>/app`. The checkout hash keeps two worktrees from sharing or wiping each other's build.
2. Installs dependencies once per `package-lock.json` hash into `%TEMP%/client-billing-verify/deps-<hash>/` (`npm ci`, about 50s, first run only). The workspace sits inside that directory, so `node_modules` resolves by walking up. A symlinked or junctioned `node_modules` does not work: Turbopack rejects it ("points out of the filesystem root").
3. Runs `next build`, skipped when the source fingerprint is unchanged. Then `next start -H 127.0.0.1 -p <free port>` with `CLIENT_BILLING_SEED_MODE=demo` and `CLIENT_BILLING_DATABASE=<workspace>/data/<run id>/client-billing.sqlite`. The demo seed creates 5 tenants, 11 identities and a seeded contract, invoice, payment and deposit per tenant.
4. Waits until `/api/auth/identities` lists `nexio-admin`, the sqlite file exists, and a logged-in `/dashboard` renders "Nexio Hyper dashboard". Ready means usable, not just listening. `/api/health` alone is not enough: it returns `{ok:true}` without touching the database.

Why a temp copy and not `next dev` in the checkout: Next refuses a second `next dev` in a directory that already has one, and the owner keeps theirs on port 3000. `next build` plus `next start` also serves the production bundle, which is what the Dockerfile ships. The app writes `.data/operational-errors.ndjson` under its working directory, so running from the copy keeps the checkout's `.data` untouched. The running instance does not follow later edits: run `cb down` then `cb up` after changing source. `doctor` warns when the checkout moved since the build.

`up` prints `{ port, pid, url, dbPath, runId, evidenceDir, workspace, logFile }`. Several instances can run side by side with `--name <n>` (each has its own state, port, database and workspace). `cb up --dry-run` shows the plan.

## Doctor

```
cb doctor          # read-only; exit 1 and an `issues` list when anything is off
```

It reports: recorded pid alive, whether the port's listener is inside the process tree `up` started (so a foreign server on a reused port is flagged), `/api/health`, seed present, database file, the commit and dirty-file count the build came from, and whether the source changed since. Run it first whenever anything looks off, and before trusting a long-lived instance.

## Drive

Demo login has no password. The picker at `/` offers every seeded identity, and the app stores the chosen id in the httpOnly cookie `client-billing-demo-session`.

```
cb login                         # lists identities
cb login nexio-admin             # real picker in Playwright; saves the session for later commands
cb snapshot /customers --out customers.aria.txt
cb screenshot /invoices invoices.png --wait-text "Invoice register"
cb api GET "/api/customers?search=Orbit"
cb api POST /api/customers '{"companyName":"Orbit Labs",...}' --dry-run
cb db "SELECT invoice_number,total_minor,status FROM invoices WHERE tenant_id='nexio'"
cb run .claude/skills/verify/journeys/customer-then-invoice.mjs --as nexio-admin
```

Identities: `superadmin` (platform: `/dashboard`, `/tenants` only), and for each tenant `nexio`, `maasp`, `evo`, `gripdata`, `od` an `<tenant>-admin` (sees Admin Console: settings, users, logs) and `<tenant>-user` (no Admin Console). `--as <id>` on `api`, `snapshot`, `screenshot` and `run` picks the identity; without it the last `login` wins, else `nexio-admin`. `--anonymous` sends no session, to prove signed-out behavior.

- `snapshot` returns the Playwright ARIA snapshot and `finalPath`. If the app redirected (for example a tenant admin opening `/tenants` lands on `/dashboard`) the result carries a `warning`. Prefer role and accessible-name handles over CSS. `e2e/*.spec.ts` in the repo holds proven selectors; the feature files quote them.
- `run <script>` is the way to script a multi-step UI journey. It can mutate data, so `--dry-run` resolves the script, identity and evidence dir without launching anything. The script default-exports `async ({ page, api, db, shot, args, evidenceDir, baseUrl }) => result`. `shot('name')` writes a numbered screenshot into the evidence dir. Do not write a separate Playwright harness.
- `api` sends the session cookie. Non-GET calls accept `--dry-run`, which prints the request and sends nothing. Binary bodies (PDF) are saved into the evidence dir with their sha256.
- `db` opens the sqlite read-only with `node:sqlite`. It rejects anything but SELECT, WITH, `PRAGMA table_info` and EXPLAIN. Use it for the second, read-only view of a mutation. Tables: `tenants users customers services contracts contract_services security_deposits invoices payments payment_reminders additional_services task_notes tenant_settings operational_logs quotations bulk_invoice_runs tenant_lifecycle_events delivery_log`. The instance runs with `CLIENT_BILLING_MAIL_TRANSPORT=capture`, so outgoing mail lands in `mail-capture.json` beside the sqlite file (see `features/email.md`). Money columns end in `_minor` (paise).
- Git Bash on Windows rewrites a leading `/api/...` argument into `C:/Program Files/Git/api/...`. The CLI undoes that for `api`, `snapshot` and `screenshot`, but set `MSYS_NO_PATHCONV=1` when you pass paths to other tools.
- Windows PowerShell 5.1 strips inner double quotes from arguments passed to native programs, so `'{"a":1}'` arrives as `{a:1}`. For `api` write the body to a file and pass `--body-file <file>` (or `--body-file -` for stdin). Git Bash and `run` scripts are unaffected.

Start from `features/README.md` and open the feature file that matches what you are proving. A proof that exercises only one entry point is incomplete when the feature file lists others.

## Evidence

Evidence goes to `.claude/skills/verify/evidence/<run id>/` by default (the run id is in the `up` output; the directory is gitignored except `.gitkeep`). Choose another with `--evidence <name>` (a bare name maps to `evidence/<name>/`) or an absolute path. Each command appends one line to `commands.ndjson` there.

Proof standards:

- Exercise the real user path: the UI, or the API the UI calls. No internal setters, no hand-edited rows.
- Capture the action and the resulting state, not only the final screen: a screenshot or ARIA snapshot before and after, the API status and body, and the `db` row.
- Verify side effects alongside what is visible: invoice rows, payment rows, `operational_logs` entries, downloaded file name and sha256.
- Save the `db` output with `--out` so the row survives teardown.
- The email reminder, WhatsApp reminder and SMTP test are demo-only and send nothing externally. Verify that by reading the result text and the `payment_reminders` table, not by trusting the button name.
- Report an unreachable path with the command you ran and the precondition that failed. Do not report it as verified through a different entry point.

## Cleanup

```
cb down --dry-run      # prints the kill command and the paths it would remove
cb down                # kills the recorded tree, removes the run's database dir, session files and state
cb down --purge        # also removes the workspace and its build cache
cb down --keep-data    # keep the sqlite for post-mortem
```

`down` refuses to kill a pid whose command line no longer looks like our `next start` (pid reuse) and says what to do. It never deletes evidence. After a failed iteration run `cb down` so broken attempts do not strand a port, then `cb up` again. `up` also cleans up after itself when startup fails.

## Helpers

- `control-billing.mjs`: the CLI above. Executable with `node`. `--help` on any subcommand documents its flags.
- `journeys/customer-then-invoice.mjs`: proven end-to-end journey (create a customer in the UI, create an invoice for it in the dialog, read both rows back). Run it with `cb run`.
- `features/`: the feature map.
- `.state/` (gitignored): instance state and saved sessions. `evidence/` (gitignored except `.gitkeep`): proofs.
- Dependency and build cache: `%TEMP%/client-billing-verify/` (override with `CLIENT_BILLING_VERIFY_HOME`). Safe to delete when no instance is up.

Keep the map honest as the app changes with `/maintain-verification-skill`.
