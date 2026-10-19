#!/usr/bin/env node
// control-billing: the lever for driving Client Billing Service the way a user does.
// Every subcommand prints ONE JSON object on stdout. Diagnostics go to stderr.
// Run `node control-billing.mjs --help` or `node control-billing.mjs <command> --help`.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SKILL_DIR, '..', '..', '..');
const STATE_DIR = join(SKILL_DIR, '.state');
const EVIDENCE_ROOT = join(SKILL_DIR, 'evidence');
const CACHE_ROOT = process.env.CLIENT_BILLING_VERIFY_HOME ?? join(tmpdir(), 'client-billing-verify');
const NEVER_TOUCH_PORTS = [3000, 3100];
const SESSION_COOKIE = '__Host-cbs_demo';
const SOURCE_ITEMS = ['src', 'public', 'db', 'next.config.ts', 'package.json', 'tsconfig.json', 'next-env.d.ts'];
const DATABASE_PREFIX = 'cbs_verify_';
const IS_WIN = process.platform === 'win32';

class CliError extends Error {
  constructor(message, hint) { super(message); this.hint = hint; }
}

const log = (...parts) => process.stderr.write(`[control-billing] ${parts.join(' ')}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha = (text, length = 12) => createHash('sha256').update(text).digest('hex').slice(0, length);

// ---------------------------------------------------------------- command table

const INSTANCE = { name: { type: 'string', desc: 'Instance name (default "default"). One state file per name.' } };
const EVIDENCE = { evidence: { type: 'string', desc: 'Evidence dir. A bare name maps to .claude/skills/verify/evidence/<name>/; a path is used as given. Default: evidence/<run id of the instance>.' } };
const AS = {
  as: { type: 'string', desc: 'Demo identity to act as (default: the last identity logged in, else nexio-admin).' },
  anonymous: { type: 'boolean', desc: 'Send no session at all (to prove signed-out behavior).' },
};

const COMMANDS = {
  doctor: {
    summary: 'Read-only check: is the instance ours, which port, which database, build/commit, health, session.',
    usage: 'doctor [--name <instance>]',
    flags: { ...INSTANCE },
    examples: ['node control-billing.mjs doctor'],
  },
  up: {
    summary: 'Build a private copy of the working tree and start it on an isolated port with a fresh, seeded Postgres database.',
    usage: 'up [--name <instance>] [--port <n>] [--rebuild] [--dry-run]',
    flags: {
      ...INSTANCE,
      port: { type: 'string', desc: 'Fixed port. Default: a free ephemeral port. Ports 3000 and 3100 are refused.' },
      rebuild: { type: 'boolean', desc: 'Ignore the build cache and run next build again.' },
      'dry-run': { type: 'boolean', desc: 'Print what would be created and started; change nothing.' },
    },
    examples: ['node control-billing.mjs up', 'node control-billing.mjs up --name second --rebuild'],
  },
  down: {
    summary: 'Stop only the process tree that `up` recorded in the state file. Evidence is never deleted.',
    usage: 'down [--name <instance>] [--keep-data] [--purge] [--dry-run]',
    flags: {
      ...INSTANCE,
      'keep-data': { type: 'boolean', desc: 'Keep the instance database and its data directory (default: drop and delete them, they are scratch).' },
      purge: { type: 'boolean', desc: 'Also delete the instance workspace and its build cache.' },
      'dry-run': { type: 'boolean', desc: 'Print the kill command and the paths that would be removed; change nothing.' },
    },
    examples: ['node control-billing.mjs down', 'node control-billing.mjs down --dry-run'],
  },
  login: {
    summary: 'Sign in as a demo identity through the real picker (Playwright) and save the session. No identity lists the choices.',
    usage: 'login [<identity>] [--no-browser] [--name <instance>] [--evidence <dir>]',
    flags: { ...INSTANCE, ...EVIDENCE, 'no-browser': { type: 'boolean', desc: 'Skip Playwright and call POST /api/auth/demo-login directly.' } },
    examples: ['node control-billing.mjs login', 'node control-billing.mjs login nexio-admin', 'node control-billing.mjs login superadmin'],
  },
  snapshot: {
    summary: 'Accessibility (ARIA) snapshot of a path, rendered by Playwright with the saved session.',
    usage: 'snapshot <path> [--as <identity>] [--wait-text <text>] [--out <file>] [--viewport WxH]',
    flags: {
      ...INSTANCE, ...EVIDENCE, ...AS,
      'wait-text': { type: 'string', desc: 'Wait until this text is visible before snapshotting.' },
      out: { type: 'string', desc: 'Also write the snapshot to this file inside the evidence dir.' },
      viewport: { type: 'string', desc: 'WxH, default 1280x900.' },
    },
    examples: ['node control-billing.mjs snapshot /customers --out customers.aria.txt'],
  },
  screenshot: {
    summary: 'Screenshot of a path with the saved session. A relative output goes into the evidence dir.',
    usage: 'screenshot <path> <out.png> [--as <identity>] [--wait-text <text>] [--full-page] [--viewport WxH]',
    flags: {
      ...INSTANCE, ...EVIDENCE, ...AS,
      'wait-text': { type: 'string', desc: 'Wait until this text is visible before capturing.' },
      'full-page': { type: 'boolean', desc: 'Capture the full scroll height.' },
      viewport: { type: 'string', desc: 'WxH, default 1280x900.' },
    },
    examples: ['node control-billing.mjs screenshot /invoices invoices.png --wait-text "Invoice register"'],
  },
  api: {
    summary: 'Authenticated HTTP call with the demo session cookie. JSON in, JSON out.',
    usage: 'api <METHOD> <path> [<json body> | --body-file <file|->] [--as <identity>] [--out <file>] [--dry-run]',
    flags: {
      ...INSTANCE, ...EVIDENCE, ...AS,
      'body-file': { type: 'string', desc: 'Read the JSON body from this file, or from stdin when the value is -. Use it on PowerShell, which strips inner double quotes from arguments.' },
      out: { type: 'string', desc: 'Save the raw response body to this file inside the evidence dir (always done for binary bodies such as PDFs).' },
      'dry-run': { type: 'boolean', desc: 'For POST/PUT/PATCH/DELETE: print the request and send nothing.' },
    },
    examples: [
      'node control-billing.mjs api GET "/api/customers?pageSize=5"',
      'node control-billing.mjs api POST /api/customers \'{"companyName":"Orbit Labs",...}\' --dry-run',
    ],
  },
  db: {
    summary: 'Read-only SQL against the instance Postgres database, as cbs_owner (every tenant) in a READ ONLY transaction.',
    usage: 'db "<SELECT ...>" [--param <v>]... [--limit <n>] [--out <file>] [--name <instance>]',
    flags: {
      ...INSTANCE, ...EVIDENCE,
      limit: { type: 'string', desc: 'Max rows returned (default 200).' },
      out: { type: 'string', desc: 'Also write the result JSON to this file inside the evidence dir.' },
      param: { type: 'string', desc: 'Value for the next ? outside quotes (sent as $1, $2, ...); repeat the flag for more.', multiple: true },
    },
    examples: ['node control-billing.mjs db "SELECT invoice_number,total_minor,status FROM invoices WHERE tenant_id=\'nexio\'"'],
  },
  run: {
    summary: 'Run your own Playwright script with an authenticated page. The script default-exports an async function.',
    usage: 'run <script.mjs> [--as <identity>] [--args <json> | --args-file <file>] [--name <instance>] [--evidence <dir>] [--dry-run]',
    flags: { ...INSTANCE, ...EVIDENCE, ...AS, 'dry-run': { type: 'boolean', desc: 'Resolve the script, identity, base URL and evidence dir, print them, and launch nothing. Scripts can mutate data, so check first.' }, args: { type: 'string', desc: 'JSON passed to the script as `args`.' }, 'args-file': { type: 'string', desc: 'Read the args JSON from a file (use on PowerShell, which strips inner double quotes).' } },
    examples: ['node control-billing.mjs run journeys/create-customer.mjs --as nexio-admin'],
    notes: 'Script signature: export default async ({ page, context, baseUrl, evidenceDir, identity, args, api, db, shot }) => result. api(method, path, body) and db(sql, params) behave like the subcommands. shot(name) screenshots into the evidence dir.',
  },
};

// ---------------------------------------------------------------- argument parsing

function parseArgs(argv, spec) {
  const flags = {}; const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (!token.startsWith('--')) { positionals.push(token); continue; }
    const [rawName, inline] = token.slice(2).split(/=(.*)/s, 2);
    const name = rawName === 'help' ? 'help' : rawName;
    if (name === 'help' || name === 'json') { flags[name] = true; continue; }
    const def = spec.flags[name];
    if (!def) throw new CliError(`Unknown flag --${name}.`, `Run \`node control-billing.mjs ${spec.name} --help\` for the flags this command takes.`);
    let value = true;
    if (def.type === 'string') {
      value = inline ?? argv[++i];
      if (value === undefined) throw new CliError(`Flag --${name} needs a value.`, `Example: --${name} <value>.`);
    }
    if (def.multiple) (flags[name] ??= []).push(value); else flags[name] = value;
  }
  return { flags, positionals };
}

function helpText(name) {
  if (!name) {
    const rows = Object.entries(COMMANDS).map(([key, c]) => `  ${key.padEnd(11)}${c.summary}`).join('\n');
    return `control-billing: drive Client Billing Service in isolation. Every command prints one JSON object.\n\nUsage: node control-billing.mjs <command> [args] [flags]\n\nCommands:\n${rows}\n\nTypical proof: up -> doctor -> login -> (api | run | snapshot | screenshot) -> db -> down.\nGlobal: --help (any command), never touches ports 3000/3100 or processes it did not start.\nRun \`node control-billing.mjs <command> --help\` for flags and examples.\n`;
  }
  const c = COMMANDS[name];
  const flags = Object.entries(c.flags).map(([key, f]) => `  --${key}${f.type === 'string' ? ' <value>' : ''}`.padEnd(26) + f.desc).join('\n');
  return `${name}: ${c.summary}\n\nUsage: node control-billing.mjs ${c.usage}\n\nFlags:\n${flags}\n\nExamples:\n${c.examples.map((e) => `  ${e}`).join('\n')}\n${c.notes ? `\nNotes: ${c.notes}\n` : ''}`;
}

// ---------------------------------------------------------------- state, evidence, paths

function statePath(name) { return join(STATE_DIR, `${name}.json`); }
function sessionPath(name, identity) { return join(STATE_DIR, `${name}.${identity}.session.json`); }
function instanceName(flags) {
  const name = flags.name ?? 'default';
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw new CliError(`Instance name "${name}" is not allowed.`, 'Use lowercase letters, digits and dashes, up to 31 characters.');
  return name;
}
function readState(name) {
  const file = statePath(name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
function writeState(name, state) { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(statePath(name), `${JSON.stringify(state, null, 2)}\n`); }
function requireState(name) {
  const state = readState(name);
  if (!state) throw new CliError(`No instance "${name}" is recorded.`, `Start one with \`node control-billing.mjs up${name === 'default' ? '' : ` --name ${name}`}\`.`);
  return state;
}
function requireLive(name) {
  const state = requireState(name);
  if (!pidAlive(state.pid)) throw new CliError(`Instance "${name}" was recorded but its process (pid ${state.pid}) is gone.`, `Run \`node control-billing.mjs down --name ${name}\` to clear the stale state, then \`up\` again.`);
  return state;
}

function evidenceDir(flags, state) {
  const wanted = flags.evidence ?? state?.runId ?? 'adhoc';
  const dir = isAbsolute(wanted) ? wanted : /[\\/]/.test(wanted) ? resolve(process.cwd(), wanted) : join(EVIDENCE_ROOT, wanted);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function inEvidence(dir, file) {
  const target = isAbsolute(file) ? file : join(dir, file);
  mkdirSync(dirname(target), { recursive: true });
  return target;
}
function trail(dir, entry) {
  try { appendFileSync(join(dir, 'commands.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } catch { /* evidence trail is best effort */ }
}

// ---------------------------------------------------------------- processes and ports

function powershellJson(script) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!out.trim()) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}
function processTable() {
  if (IS_WIN) {
    return powershellJson('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress')
      .map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, cmd: p.CommandLine ?? '' }));
  }
  return execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
    .map((line) => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] } : null; }).filter(Boolean);
}
function descendants(table, root) {
  const found = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of table) if (!found.has(p.pid) && found.has(p.ppid)) { found.add(p.pid); grew = true; }
  }
  return found;
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function listenerPid(port) {
  try {
    if (IS_WIN) {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols[3] === 'LISTENING' && cols[1].slice(cols[1].lastIndexOf(':') + 1) === String(port)) return Number(cols[4]);
      }
      return null;
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    return Number(out.split('\n')[0]) || null;
  } catch { return null; }
}
async function freePort() {
  return new Promise((done, fail) => {
    const server = net.createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); });
  });
}
function killTree(pid) {
  if (IS_WIN) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { const table = processTable(); for (const target of descendants(table, pid)) { try { process.kill(target, 'SIGKILL'); } catch { /* already gone */ } } }
}
function killCommand(pid) { return IS_WIN ? `taskkill /PID ${pid} /T /F` : `kill -9 <process tree of ${pid}>`; }

// ---------------------------------------------------------------- git, deps, workspace

function git(...args) {
  try { return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
function gitInfo() {
  const status = git('status', '--porcelain');
  return { commit: git('rev-parse', '--short', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), dirtyFiles: status ? status.split('\n').length : 0 };
}
function lockHash() { return sha(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')); }
function depsDir() { return join(CACHE_ROOT, `deps-${lockHash()}`); }
function ensureDeps() {
  const dir = depsDir();
  const marker = join(dir, 'node_modules', 'next', 'package.json');
  if (existsSync(marker) && existsSync(join(dir, 'node_modules', 'playwright-core', 'package.json'))) return dir;
  log(`installing dependencies once into ${dir} (npm ci, about a minute)`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(REPO_ROOT, 'package.json'), join(dir, 'package.json'));
  cpSync(join(REPO_ROOT, 'package-lock.json'), join(dir, 'package-lock.json'));
  try { execFileSync(IS_WIN ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'], shell: IS_WIN }); }
  catch { throw new CliError(`npm ci failed in ${dir}.`, 'Check network access and rerun. The repo checkout was not modified.'); }
  return dir;
}
function sourceFingerprint() {
  const hash = createHash('sha256');
  const walk = (path) => {
    const info = statSync(path);
    if (info.isDirectory()) { for (const entry of readdirSync(path).sort()) walk(join(path, entry)); return; }
    hash.update(`${relative(REPO_ROOT, path)}:${info.size}:${Math.round(info.mtimeMs)}\n`);
  };
  for (const item of SOURCE_ITEMS) { const path = join(REPO_ROOT, item); if (existsSync(path)) walk(path); }
  return hash.digest('hex').slice(0, 16);
}
/** The workspace lives inside the dependency dir so Node and Turbopack find the real node_modules by walking up. A symlinked node_modules is rejected by Turbopack. The checkout path is part of the key so two worktrees never share or wipe each other's build. */
function workspaceFor(name) { return join(depsDir(), 'instances', `${sha(REPO_ROOT, 8)}-${name}`); }

function nextBin(deps) { return join(deps, 'node_modules', 'next', 'dist', 'bin', 'next'); }

function playwright(deps) {
  const require = createRequire(join(deps, 'package.json'));
  try { return require('@playwright/test'); } catch { throw new CliError('Playwright is not installed in the dependency cache.', `Delete ${deps} and run \`up\` again to reinstall.`); }
}
async function launchBrowser(deps) {
  const { chromium } = playwright(deps);
  try { return await chromium.launch({ headless: true }); }
  catch (error) {
    throw new CliError(`Chromium could not start: ${String(error.message).split('\n')[0]}`, `Install the browser Playwright expects with \`node ${nextBin(deps).replace(/next[\\/]dist[\\/]bin[\\/]next$/, 'playwright-core/cli.js')} install chromium\`.`);
  }
}

// ---------------------------------------------------------------- HTTP helpers

async function httpJson(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { response, body, text };
}
async function apiLogin(base, identity) {
  const { response, body } = await httpJson(base, '/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: identity }) });
  if (!response.ok) throw new CliError(`Login as "${identity}" failed (${response.status}): ${body?.message ?? 'unknown'}.`, 'Run `node control-billing.mjs login` with no identity to list valid ones.');
  const raw = response.headers.getSetCookie?.().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
  const value = raw.split(';')[0].slice(SESSION_COOKIE.length + 1);
  if (!value) throw new CliError('Login succeeded but no session cookie was set.', 'The app contract changed. Read src/app/api/auth/demo-login/route.ts and update control-billing.mjs.');
  return { value, session: body.identity };
}
async function listIdentities(base) {
  const { response, body } = await httpJson(base, '/api/auth/identities');
  if (!response.ok) throw new CliError(`GET /api/auth/identities answered ${response.status}.`, 'Run `doctor` to see whether the instance is healthy.');
  return body.identities;
}

function saveSession(name, identity, cookieValue, storageState, makeCurrent = false) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(sessionPath(name, identity), JSON.stringify({ identity, cookie: { name: SESSION_COOKIE, value: cookieValue }, storageState }, null, 2));
  const state = readState(name);
  if (state && makeCurrent) writeState(name, { ...state, currentIdentity: identity });
}
async function sessionFor(name, state, identity) {
  const file = sessionPath(name, identity);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.baseUrl === undefined || saved.baseUrl === state.url) return saved;
  }
  const { value } = await apiLogin(state.url, identity);
  const storageState = { cookies: [{ name: SESSION_COOKIE, value, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] };
  saveSession(name, identity, value, storageState);
  return JSON.parse(readFileSync(file, 'utf8'));
}
function identityFrom(flags, state) { return flags.as ?? state.currentIdentity ?? 'nexio-admin'; }

// ---------------------------------------------------------------- db

/** The four role URLs from .env.example, pointed at this instance's own database. `server` stays on the admin URL's database, to create and drop it. */
function databaseFor(name) {
  const names = { admin: 'DATABASE_ADMIN_URL', owner: 'DATABASE_MIGRATE_URL', app: 'DATABASE_URL', platform: 'DATABASE_PLATFORM_URL' };
  const missing = Object.values(names).filter((key) => !process.env[key]);
  if (missing.length) throw new CliError(`The instance needs Postgres, and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} unset.`, 'Start Postgres with `npm run db:up` and export the four URLs it prints (see .env.example).');
  const database = `${DATABASE_PREFIX}${name.replaceAll('-', '_')}`;
  const on = (url) => { const parsed = new URL(url); parsed.pathname = `/${database}`; return parsed.toString(); };
  return { database, server: process.env[names.admin], admin: on(process.env[names.admin]), owner: on(process.env[names.owner]), app: on(process.env[names.app]), platform: on(process.env[names.platform]) };
}

async function withClient(deps, url, fn, options = {}) {
  const { Client } = createRequire(join(deps, 'package.json'))('pg');
  const client = new Client({ connectionString: url, ...options });
  try { await client.connect(); } catch (error) { throw new CliError(`Cannot reach Postgres at ${new URL(url).host}: ${error.message}`, 'Start it with `npm run db:up`, or check the exported URLs.'); }
  try { return await fn(client); } finally { await client.end(); }
}

/** Drops and recreates the instance database, then migrates and seeds it the way e2e/global-setup.ts builds cbs_e2e. */
async function recreateDatabase(deps, app, db) {
  log(`recreating ${db.database}: migrate, then the demo seed`);
  await withClient(deps, db.server, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${db.database} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${db.database}`);
  });
  const { SCHEMA_GRANTS } = await import(pathToFileURL(join(app, 'src', 'lib', 'db', 'schema-grants.ts')).href);
  await withClient(deps, db.admin, (client) => client.query(SCHEMA_GRANTS));
  const asOwner = (what, args) => {
    try { execFileSync(process.execPath, args, { cwd: app, env: { ...process.env, DATABASE_MIGRATE_URL: db.owner }, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }); }
    catch (error) { throw new CliError(`${what} ${db.database} failed:\n${String(error.stderr ?? error.message).trim().split('\n').slice(-8).join('\n')}`, 'Fix the migration or db/seed/demo.ts in the checkout, then rerun `up`.'); }
  };
  asOwner('Migrating', [join(deps, 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js'), 'up', '-m', 'db/migrations', '-d', 'DATABASE_MIGRATE_URL', '--no-verbose']);
  asOwner('Seeding', [join('db', 'seed', 'demo.ts')]);
}

async function dropDatabase(state) {
  if (!state.db?.database?.startsWith(DATABASE_PREFIX)) throw new CliError(`Refusing to drop ${state.db?.database}: only ${DATABASE_PREFIX}* databases belong to this tool.`, 'Drop it by hand if it is really ours.');
  await withClient(state.depsDir, state.db.server, (client) => client.query(`DROP DATABASE IF EXISTS ${state.db.database} WITH (FORCE)`));
}

/** `?` outside single quotes becomes $1, $2, ... so the SQL can sit in double quotes in any shell. */
function numberPlaceholders(sql) {
  let count = 0; let quoted = false; let text = '';
  for (const char of sql) {
    if (char === "'") quoted = !quoted;
    text += char === '?' && !quoted ? `$${++count}` : char;
  }
  return text;
}

async function runQuery(state, sql, params = [], limit = 200) {
  if (!/^\s*(select|with|explain)\b/i.test(sql)) throw new CliError('db only accepts read queries (SELECT, WITH, EXPLAIN).', 'Change data through the app (`api` or the UI), then read it back with `db`.');
  const { pgTypes } = await import(pathToFileURL(join(state.app, 'src', 'lib', 'db', 'types.ts')).href);
  return withClient(state.depsDir, state.db.owner, async (client) => {
    await client.query('BEGIN READ ONLY');
    try {
      const { rows } = await client.query(numberPlaceholders(sql), params);
      return { count: rows.length, truncated: rows.length > limit, rows: rows.slice(0, limit) };
    } catch (error) {
      throw new CliError(`SQL failed: ${error.message}`, 'List tables with `db "SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' ORDER BY 1"` and columns with `db "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?" --param invoices`.');
    } finally { await client.query('ROLLBACK'); }
  }, { types: pgTypes });
}

// ---------------------------------------------------------------- commands

async function cmdDoctor(flags) {
  const name = instanceName(flags);
  const state = readState(name);
  const checks = []; const issues = [];
  const check = (id, ok, detail) => { checks.push({ id, ok, detail }); if (!ok) issues.push(`${id}: ${detail}`); };
  const out = {
    ok: false, instance: name, git: gitInfo(), neverTouch: NEVER_TOUCH_PORTS.map((port) => ({ port, listening: listenerPid(port) !== null, note: 'Not ours if listening. This tool never signals it.' })),
  };
  if (!state) {
    out.instance = { name, recorded: false };
    out.issues = [`No instance "${name}" recorded.`]; out.hint = 'Run `node control-billing.mjs up`.';
    return out;
  }
  const alive = pidAlive(state.pid);
  check('process-alive', alive, alive ? `pid ${state.pid}` : `recorded pid ${state.pid} is gone`);
  let ownerPid = null; let owned = false;
  if (alive) {
    ownerPid = listenerPid(state.port);
    const tree = descendants(processTable(), state.pid);
    owned = ownerPid !== null && tree.has(ownerPid);
    check('port-owned-by-us', owned, ownerPid === null ? `nothing listens on ${state.port}` : owned ? `pid ${ownerPid} is inside the process tree started by \`up\`` : `pid ${ownerPid} owns port ${state.port} but is not in our tree: do not drive this`);
  }
  let health = null;
  if (alive && owned) {
    try {
      const { response, body } = await httpJson(state.url, '/api/health');
      health = { status: response.status, body };
      check('health', response.status === 200 && body?.ok === true, `GET /api/health -> ${response.status}`);
      const identities = await listIdentities(state.url);
      check('seeded', identities.some((i) => i.id === 'nexio-admin'), `${identities.length} demo identities, nexio-admin ${identities.some((i) => i.id === 'nexio-admin') ? 'present' : 'missing'}`);
    } catch (error) { check('health', false, `request failed: ${error.message}`); }
  }
  try {
    const tenants = await withClient(state.depsDir, state.db.owner, async (client) => (await client.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n);
    check('database', tenants > 0, `${state.db.database} holds ${tenants} tenants`);
  } catch (error) { check('database', false, `${state.db?.database}: ${error.message}`); }
  const current = gitInfo();
  const stale = current.commit !== state.git?.commit || state.sourceFingerprint !== sourceFingerprint();
  out.instance = {
    name, url: state.url, port: state.port, pid: state.pid, listenerPid: ownerPid, database: state.db?.database, mailCaptureFile: state.mailCaptureFile, workspace: state.workspace, logFile: state.logFile,
    startedAt: state.startedAt, runId: state.runId, evidenceDir: join(EVIDENCE_ROOT, state.runId), currentIdentity: state.currentIdentity ?? null,
    builtFrom: state.git, sourceChangedSinceBuild: stale,
  };
  if (stale) out.warning = 'The checkout changed after this instance was built. Run `down` then `up` before verifying new edits.';
  out.health = health; out.checks = checks; out.issues = issues; out.ok = issues.length === 0;
  if (!out.ok) out.hint = 'Run `node control-billing.mjs down` then `up` for a clean instance. Never kill the port owner by hand unless it is in our tree.';
  return out;
}

async function cmdUp(flags) {
  const name = instanceName(flags);
  const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${name}`;
  const workspace = workspaceFor(name);
  const app = join(workspace, 'app');
  const existing = readState(name);
  if (existing && pidAlive(existing.pid)) throw new CliError(`Instance "${name}" is already up on port ${existing.port} (pid ${existing.pid}).`, `Use it, or run \`node control-billing.mjs down --name ${name}\` first, or pick another --name.`);
  let port = flags.port ? Number(flags.port) : null;
  if (port !== null) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new CliError(`--port ${flags.port} is not a usable port.`, 'Pick 1024-65535, or omit --port for a free one.');
    if (NEVER_TOUCH_PORTS.includes(port)) throw new CliError(`Port ${port} belongs to the owner's own servers and is off limits.`, 'Omit --port to get a free port.');
    const owner = listenerPid(port);
    if (owner) throw new CliError(`Port ${port} is already in use by pid ${owner}, which this tool did not start.`, 'Omit --port to get a free port.');
  }
  const deps = depsDir();
  const db = databaseFor(name);
  const plan = {
    runId, workspace, app, deps, database: db.database, port: port ?? '(free ephemeral port chosen at start)', commit: gitInfo(),
    steps: ['npm ci into the dependency cache once per package-lock.json hash', 'copy src, public, db and config into the workspace (the workspace sits inside the dependency cache, so node_modules resolves by walking up)', `drop and recreate ${db.database} on the exported Postgres, migrate it and run db/seed/demo.ts, as e2e/global-setup.ts does for cbs_e2e`, 'next build in the workspace (skipped when the source fingerprint is unchanged)', `next start -H 127.0.0.1 with DATABASE_URL and DATABASE_PLATFORM_URL on ${db.database} and the capture mail transport`, 'wait until /api/auth/identities lists nexio-admin and /dashboard renders "Nexio Hyper dashboard"'],
  };
  if (flags['dry-run']) return { ok: true, dryRun: true, plan };

  ensureDeps();
  if (existing) { rmSync(statePath(name), { force: true }); log('cleared stale state for', name); }
  mkdirSync(workspace, { recursive: true });
  const fingerprint = sourceFingerprint();
  const buildRecordPath = join(workspace, 'build.json');
  const buildRecord = existsSync(buildRecordPath) ? JSON.parse(readFileSync(buildRecordPath, 'utf8')) : null;
  const reuseBuild = !flags.rebuild && buildRecord?.fingerprint === fingerprint && existsSync(join(app, '.next', 'BUILD_ID'));
  if (!reuseBuild) {
    log('syncing source into', app);
    mkdirSync(app, { recursive: true });
    for (const item of [...SOURCE_ITEMS, '.next', '.data']) rmSync(join(app, item), { recursive: true, force: true });
    for (const item of SOURCE_ITEMS) { const from = join(REPO_ROOT, item); if (existsSync(from)) cpSync(from, join(app, item), { recursive: true }); }
  }
  await recreateDatabase(deps, app, db);
  const appEnv = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: db.app, DATABASE_PLATFORM_URL: db.platform };
  delete appEnv.DATABASE_MIGRATE_URL; delete appEnv.DATABASE_ADMIN_URL;
  if (!reuseBuild) {
    log('next build (about 15 seconds on a warm cache)');
    const buildLog = join(workspace, 'build.log');
    const fd = openSync(buildLog, 'w');
    try {
      execFileSync(process.execPath, [nextBin(deps), 'build'], { cwd: app, stdio: ['ignore', fd, fd], env: appEnv });
    } catch {
      closeSync(fd);
      throw new CliError(`next build failed. Last lines of ${buildLog}:\n${tailFile(buildLog, 25)}`, 'Fix the build error in the checkout (the build runs on a copy, so the checkout is untouched), then rerun `up`.');
    }
    closeSync(fd);
    writeFileSync(buildRecordPath, JSON.stringify({ fingerprint, builtAt: new Date().toISOString(), git: gitInfo() }, null, 2));
  } else log('reusing cached build', fingerprint);

  port ??= await freePort();
  const dataDir = join(workspace, 'data', runId);
  const mailCaptureFile = join(dataDir, 'mail-capture.json');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(workspace, 'logs'), { recursive: true });
  const logFile = join(workspace, 'logs', `server-${runId}.log`);
  const out = openSync(logFile, 'a');
  const env = { ...appEnv, CLIENT_BILLING_MAIL_TRANSPORT: 'capture', CLIENT_BILLING_MAIL_CAPTURE_FILE: mailCaptureFile };
  delete env.PORT; delete env.HOSTNAME;
  const child = spawn(process.execPath, [nextBin(deps), 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: app, env, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref(); closeSync(out);
  const url = `http://127.0.0.1:${port}`;
  const state = { name, runId, pid: child.pid, port, url, db, mailCaptureFile, dataDir, workspace, app, logFile, startedAt: new Date().toISOString(), git: gitInfo(), sourceFingerprint: fingerprint, depsDir: deps, currentIdentity: null };
  writeState(name, state);
  try {
    await waitUntilUsable(state);
  } catch (error) {
    log('start failed, cleaning up pid', state.pid);
    try { killTree(state.pid); } catch { /* already gone */ }
    rmSync(statePath(name), { force: true });
    throw error;
  }
  const evidence = evidenceDir({}, state);
  trail(evidence, { command: 'up', port, pid: state.pid, database: db.database, git: state.git });
  return { ok: true, name, url, port, pid: child.pid, database: db.database, mailCaptureFile, runId, evidenceDir: evidence, workspace, logFile, builtFrom: state.git, reusedBuild: reuseBuild, ready: 'identities list nexio-admin and /dashboard rendered "Nexio Hyper dashboard"' };
}

function tailFile(file, lines) {
  try { return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n'); } catch { return '(no log)'; }
}

async function waitUntilUsable(state) {
  const deadline = Date.now() + 120_000;
  let last = 'no response yet';
  while (Date.now() < deadline) {
    if (!pidAlive(state.pid)) throw new CliError(`next start exited early. Last lines of ${state.logFile}:\n${tailFile(state.logFile, 25)}`, 'Fix the error shown, then rerun `up`.');
    try {
      const identities = await listIdentities(state.url);
      if (!identities.some((i) => i.id === 'nexio-admin')) { last = 'identities loaded but nexio-admin is missing (seed did not run)'; await sleep(500); continue; }
      const { value } = await apiLogin(state.url, 'nexio-admin');
      const page = await fetch(`${state.url}/dashboard`, { headers: { cookie: `${SESSION_COOKIE}=${value}` }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const html = await page.text();
      if (page.status === 200 && html.includes('Nexio Hyper dashboard')) return;
      last = `/dashboard answered ${page.status} without the seeded heading`;
    } catch (error) { last = error.message; }
    await sleep(500);
  }
  throw new CliError(`The app did not reach a usable state within 120s (${last}). Last lines of ${state.logFile}:\n${tailFile(state.logFile, 25)}`, 'Inspect the log, fix the cause, rerun `up`.');
}

async function cmdDown(flags) {
  const name = instanceName(flags);
  const state = readState(name);
  if (!state) return { ok: true, alreadyDown: true, instance: name, note: 'No state file. Nothing was started by this tool under that name, so nothing was touched.' };
  const alive = pidAlive(state.pid);
  const table = alive ? processTable() : [];
  const entry = table.find((p) => p.pid === state.pid);
  const looksOurs = !alive || (entry && entry.cmd.includes('next') && entry.cmd.includes(String(state.port)));
  const evidence = join(EVIDENCE_ROOT, state.runId);
  const removals = [];
  if (!flags['keep-data']) removals.push(state.dataDir);
  if (flags.purge) removals.push(state.workspace);
  const plan = { instance: name, pid: state.pid, alive, killCommand: alive ? killCommand(state.pid) : null, dropsDatabase: flags['keep-data'] ? null : state.db?.database ?? null, removes: [...removals, statePath(name), ...sessionFiles(name)], keeps: [evidence] };
  if (!looksOurs) throw new CliError(`Pid ${state.pid} no longer looks like the \`next start\` we launched (command line: ${entry?.cmd.slice(0, 160)}). The pid was probably reused.`, `Nothing was killed. Delete ${statePath(name)} by hand once you have confirmed the original server is gone.`);
  if (flags['dry-run']) return { ok: true, dryRun: true, plan };
  if (alive) {
    killTree(state.pid);
    for (let i = 0; i < 40 && (pidAlive(state.pid) || listenerPid(state.port)); i++) await sleep(250);
    if (pidAlive(state.pid)) throw new CliError(`Pid ${state.pid} survived the kill.`, 'Check permissions; the state file was kept so you can retry `down`.');
  }
  if (plan.dropsDatabase) await dropDatabase(state);
  for (const path of removals) rmSync(path, { recursive: true, force: true });
  for (const file of sessionFiles(name)) rmSync(file, { force: true });
  rmSync(statePath(name), { force: true });
  const evidenceFiles = existsSync(evidence) ? readdirSync(evidence, { recursive: true }).length : 0;
  return { ok: true, instance: name, stoppedPid: alive ? state.pid : null, portFreed: listenerPid(state.port) === null, droppedDatabase: plan.dropsDatabase, removed: removals, evidenceDir: evidence, evidenceEntries: evidenceFiles };
}
function sessionFiles(name) {
  if (!existsSync(STATE_DIR)) return [];
  return readdirSync(STATE_DIR).filter((f) => f.startsWith(`${name}.`) && f.endsWith('.session.json')).map((f) => join(STATE_DIR, f));
}

async function cmdLogin(flags, [identity]) {
  const name = instanceName(flags);
  const state = requireLive(name);
  const identities = await listIdentities(state.url);
  if (!identity) return { ok: true, instance: name, identities: identities.map((i) => ({ id: i.id, role: i.role, tenant: i.tenantName, email: i.email })), hint: 'Pick one: node control-billing.mjs login <id>. The picker needs no password.' };
  if (!identities.some((i) => i.id === identity)) throw new CliError(`"${identity}" is not a demo identity.`, `Valid ids: ${identities.map((i) => i.id).join(', ')}.`);
  const evidence = evidenceDir(flags, state);
  if (flags['no-browser']) {
    const { value, session } = await apiLogin(state.url, identity);
    const storageState = { cookies: [{ name: SESSION_COOKIE, value, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] };
    saveSession(name, identity, value, storageState, true);
    trail(evidence, { command: 'login', identity, via: 'api' });
    return { ok: true, via: 'api', identity, session, cookie: SESSION_COOKIE };
  }
  const browser = await launchBrowser(state.depsDir);
  try {
    const context = await browser.newContext({ baseURL: state.url, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Choose a demo identity' }).waitFor({ timeout: 20000 });
    await page.getByLabel('Demo identity').selectOption(identity);
    await Promise.all([page.waitForURL('**/dashboard', { timeout: 20000 }), page.getByRole('button', { name: 'Enter demo' }).click()]);
    const heading = await page.getByRole('heading', { level: 1 }).first().innerText();
    const storageState = await context.storageState();
    const cookie = storageState.cookies.find((c) => c.name === SESSION_COOKIE);
    if (!cookie) throw new CliError('The picker redirected to /dashboard but no session cookie was stored.', 'The login contract changed. Read src/components/demo-login.tsx and update control-billing.mjs.');
    saveSession(name, identity, cookie.value, storageState, true);
    const shot = join(evidence, `login-${identity}.png`);
    await page.screenshot({ path: shot });
    trail(evidence, { command: 'login', identity, via: 'picker', landedOn: page.url(), heading });
    return { ok: true, via: 'picker', identity, landedOn: page.url(), heading, cookie: SESSION_COOKIE, screenshot: shot };
  } finally { await browser.close(); }
}

function parseViewport(text = '1280x900') {
  const m = text.match(/^(\d+)x(\d+)$/);
  if (!m) throw new CliError(`--viewport "${text}" is not WxH.`, 'Example: --viewport 390x844.');
  return { width: Number(m[1]), height: Number(m[2]) };
}
/** Git Bash rewrites a leading "/api/x" argument into "C:/Program Files/Git/api/x" before node sees it. Undo that. */
function unmangle(value) { return typeof value === 'string' ? value.replace(/^[A-Za-z]:[\\/]Program Files(?: \(x86\))?[\\/]Git(?=[\\/])/, '') : value; }
function pathArg(value, what) {
  if (!value || !value.startsWith('/')) throw new CliError(`${what} must be an app path starting with "/", got "${value ?? ''}".`, 'Example: /customers or /reports/gst-sales. Full URLs are refused so a run cannot wander off the isolated instance.');
  return value;
}
async function withPage(name, state, flags, fn) {
  const identity = flags.anonymous ? '(anonymous)' : identityFrom(flags, state);
  const session = flags.anonymous ? null : await sessionFor(name, state, identity);
  const browser = await launchBrowser(state.depsDir);
  try {
    const context = await browser.newContext({ baseURL: state.url, storageState: session?.storageState, viewport: parseViewport(flags.viewport), acceptDownloads: true });
    const page = await context.newPage();
    return await fn({ page, context, identity });
  } finally { await browser.close(); }
}
async function openPath(page, path, flags) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (flags['wait-text']) await page.getByText(flags['wait-text']).first().waitFor({ timeout: 20000 });
  else await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const finalPath = new URL(page.url()).pathname;
  return { status: response?.status() ?? null, finalPath, redirected: finalPath !== path.split('?')[0] };
}

async function cmdSnapshot(flags, [rawPath]) {
  const path = unmangle(rawPath);
  const name = instanceName(flags);
  const state = requireLive(name);
  pathArg(path, 'snapshot needs a path and it');
  const evidence = evidenceDir(flags, state);
  return withPage(name, state, flags, async ({ page, identity }) => {
    const nav = await openPath(page, path, flags);
    const snapshot = await page.locator('body').ariaSnapshot();
    const result = { ok: true, identity, requested: path, ...nav, title: await page.title(), snapshot: flags.out ? undefined : snapshot, snapshotLines: snapshot.split('\n').length };
    if (nav.redirected) result.warning = `The app redirected ${path} to ${nav.finalPath}. The identity may lack access, or the session expired.`;
    if (flags.out) { const target = inEvidence(evidence, flags.out); writeFileSync(target, `${snapshot}\n`); result.savedTo = target; result.note = 'Snapshot omitted from stdout because --out was given. Read the file.'; }
    trail(evidence, { command: 'snapshot', path, identity, finalPath: nav.finalPath, savedTo: result.savedTo });
    return result;
  });
}

async function cmdScreenshot(flags, [rawPath, out]) {
  const path = unmangle(rawPath);
  const name = instanceName(flags);
  const state = requireLive(name);
  pathArg(path, 'screenshot needs a path and it');
  if (!out) throw new CliError('screenshot needs an output file name.', 'Example: screenshot /customers customers.png');
  const evidence = evidenceDir(flags, state);
  return withPage(name, state, flags, async ({ page, identity }) => {
    const nav = await openPath(page, path, flags);
    const target = inEvidence(evidence, out);
    await page.screenshot({ path: target, fullPage: Boolean(flags['full-page']) });
    trail(evidence, { command: 'screenshot', path, identity, finalPath: nav.finalPath, savedTo: target });
    return { ok: true, identity, requested: path, ...nav, title: await page.title(), savedTo: target, bytes: statSync(target).size, warning: nav.redirected ? `The app redirected ${path} to ${nav.finalPath}.` : undefined };
  });
}

async function doApi(name, state, flags, method, path, bodyText, evidence) {
  const identity = flags.anonymous ? '(anonymous)' : identityFrom(flags, state);
  const session = flags.anonymous ? null : await sessionFor(name, state, identity);
  if (!path.startsWith('/')) throw new CliError(`api path must start with "/", got "${path}".`, 'Example: api GET /api/customers');
  const headers = { origin: state.url, ...(session ? { cookie: `${SESSION_COOKIE}=${session.cookie.value}` } : {}) };
  let payload;
  if (bodyText !== undefined) {
    try { JSON.parse(bodyText); } catch { throw new CliError('The body is not valid JSON.', `Pass one JSON argument, quoted for your shell, or use --body-file <file>. Received: ${bodyText.slice(0, 80)}. PowerShell strips inner double quotes from native arguments.`); }
    headers['content-type'] = 'application/json'; payload = bodyText;
  }
  const response = await fetch(`${state.url}${path}`, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const contentType = response.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await response.arrayBuffer());
  const result = { ok: response.ok, status: response.status, identity, method, path, contentType };
  const textual = /json|text|csv|xml/.test(contentType);
  if (textual) {
    const text = bytes.toString('utf8');
    try { result.body = JSON.parse(text); } catch { result.body = text.length > 20000 ? `${text.slice(0, 20000)}... (${text.length} chars, use --out to keep all)` : text; }
  }
  if (!textual || flags.out) {
    const file = inEvidence(evidence, flags.out ?? `api-${Date.now()}-${basename(path.split('?')[0]) || 'response'}.bin`);
    writeFileSync(file, bytes);
    result.savedTo = file; result.bytes = bytes.length; result.sha256 = createHash('sha256').update(bytes).digest('hex');
    if (response.headers.get('content-disposition')) result.contentDisposition = response.headers.get('content-disposition');
  }
  if (response.status === 401 || response.status === 307 || response.status === 308) result.hint = 'No valid session. Run `node control-billing.mjs login <identity>`.';
  return result;
}

async function cmdApi(flags, [method, rawPath, inlineBody]) {
  const path = unmangle(rawPath);
  let bodyText = inlineBody;
  if (flags['body-file']) {
    if (inlineBody !== undefined) throw new CliError('Pass the body inline or with --body-file, not both.', 'Drop one of them.');
    try { bodyText = readFileSync(flags['body-file'] === '-' ? 0 : resolve(process.cwd(), flags['body-file']), 'utf8'); }
    catch (error) { throw new CliError(`Cannot read the body file: ${error.message}`, 'Pass an existing file path, or - for stdin.'); }
  }
  const name = instanceName(flags);
  const state = requireLive(name);
  if (!method || !path) throw new CliError('api needs a METHOD and a path.', 'Example: api GET /api/customers');
  method = method.toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new CliError(`Unsupported method ${method}.`, 'Use GET, POST, PUT, PATCH or DELETE.');
  const evidence = evidenceDir(flags, state);
  if (flags['dry-run'] && method !== 'GET' && method !== 'HEAD') {
    return { ok: true, dryRun: true, wouldSend: { method, url: `${state.url}${path}`, identity: identityFrom(flags, state), body: bodyText === undefined ? null : JSON.parse(bodyText) }, note: 'Nothing was sent.' };
  }
  const result = await doApi(name, state, flags, method, path, bodyText, evidence);
  trail(evidence, { command: 'api', method, path, status: result.status, identity: result.identity, savedTo: result.savedTo });
  return result;
}

async function cmdDb(flags, [sql]) {
  const name = instanceName(flags);
  const state = requireState(name);
  if (!sql) throw new CliError('db needs a SQL string.', 'Example: db "SELECT count(*) AS n FROM invoices"');
  const limit = flags.limit ? Number(flags.limit) : 200;
  const result = { ok: true, database: state.db.database, sql, ...(await runQuery(state, sql, flags.param ?? [], limit)) };
  const evidence = evidenceDir(flags, state);
  if (flags.out) { const target = inEvidence(evidence, flags.out); writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`); result.savedTo = target; }
  trail(evidence, { command: 'db', sql, count: result.count, savedTo: result.savedTo });
  return result;
}

async function cmdRun(flags, [script]) {
  const name = instanceName(flags);
  const state = requireLive(name);
  if (!script) throw new CliError('run needs a script path.', 'Example: run journeys/create-customer.mjs');
  const file = resolve(process.cwd(), script);
  if (!existsSync(file)) throw new CliError(`Script ${file} does not exist.`, 'Pass a path relative to the current directory.');
  const evidence = evidenceDir(flags, state);
  let args = {};
  const argsText = flags['args-file'] ? readFileSync(resolve(process.cwd(), flags['args-file']), 'utf8') : flags.args;
  if (argsText) { try { args = JSON.parse(argsText); } catch { throw new CliError(`The args are not valid JSON (received: ${argsText.slice(0, 80)}).`, 'Example: --args \'{"company":"Orbit Labs"}\'. On PowerShell use --args-file <file>, because it strips inner double quotes.'); } }
  if (flags['dry-run']) return { ok: true, dryRun: true, script: file, identity: flags.anonymous ? '(anonymous)' : identityFrom(flags, state), baseUrl: state.url, evidenceDir: evidence, args, note: 'Nothing was launched. The script may mutate data in the isolated database.' };
  const module = await import(pathToFileURL(file).href);
  if (typeof module.default !== 'function') throw new CliError(`${script} must default-export an async function.`, 'export default async ({ page, api, db, shot }) => { ... }');
  return withPage(name, state, flags, async ({ page, context, identity }) => {
    let shots = 0;
    const helpers = {
      page, context, baseUrl: state.url, evidenceDir: evidence, identity, args,
      api: async (method, path, body) => doApi(name, state, flags, method.toUpperCase(), path, body === undefined ? undefined : JSON.stringify(body), evidence),
      db: async (sql, params = []) => runQuery(state, sql, params),
      shot: async (label) => { const target = inEvidence(evidence, `${String(++shots).padStart(2, '0')}-${label}.png`); await page.screenshot({ path: target }); return target; },
    };
    const returned = await module.default(helpers);
    trail(evidence, { command: 'run', script: relative(process.cwd(), file), identity, finalUrl: page.url() });
    return { ok: true, script: file, identity, finalUrl: page.url(), result: returned ?? null, evidenceDir: evidence };
  });
}

// ---------------------------------------------------------------- main

const HANDLERS = { doctor: cmdDoctor, up: cmdUp, down: cmdDown, login: cmdLogin, snapshot: cmdSnapshot, screenshot: cmdScreenshot, api: cmdApi, db: cmdDb, run: cmdRun };

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h' || command === 'help') { process.stdout.write(helpText()); return 0; }
  if (!COMMANDS[command]) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: `Unknown command "${command}".`, hint: `Commands: ${Object.keys(COMMANDS).join(', ')}. Run \`node control-billing.mjs --help\`.` })}\n`);
    return 1;
  }
  const spec = { name: command, ...COMMANDS[command] };
  try {
    const { flags, positionals } = parseArgs(rest, spec);
    if (flags.help) { process.stdout.write(helpText(command)); return 0; }
    const result = await HANDLERS[command](flags, positionals);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok === false ? 1 : 0;
  } catch (error) {
    const body = error instanceof CliError ? { ok: false, error: error.message, hint: error.hint } : { ok: false, error: `Unexpected failure: ${error.stack ?? error.message}`, hint: 'This is a bug in control-billing.mjs or an environment problem. Fix or report it; do not work around it with ad hoc scripts.' };
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return 1;
  }
}

process.exitCode = await main();
