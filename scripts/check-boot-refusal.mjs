// Run after `npm run build`. `next start` must exit non-zero, and bind nothing, when demo auth is asked for in
// production (ADR 0002, unit A1) and when no database is configured (ADR 0001, unit D11). Never port 3000: a
// developer's own dev server owns it.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

const port = Number(process.argv[2] ?? process.env.CLIENT_BILLING_BOOT_CHECK_PORT ?? 3212);
if (port === 3000) throw new Error('Refusing to use port 3000.');
const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
const postgres = { DATABASE_URL: 'postgres://cbs_app@127.0.0.1:1/cbs', DATABASE_PLATFORM_URL: 'postgres://cbs_platform@127.0.0.1:1/cbs' };
const noDatabase = { DATABASE_URL: '', DATABASE_PLATFORM_URL: '' };

const cases = [
  { name: 'production + demo', env: { ...postgres, CLIENT_BILLING_ENV: 'production', CLIENT_BILLING_AUTH_MODE: 'demo' }, reason: /Refusing to start: .*demo.*production/i },
  { name: 'no database', env: { ...noDatabase, CLIENT_BILLING_ENV: 'test', CLIENT_BILLING_AUTH_MODE: 'demo' }, reason: /Refusing to start: No database is configured/ },
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function refuses({ name, env, reason }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [next, 'start', '--port', String(port)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => { child.kill(); fail(`${name}: the server was still running after 60 seconds`); }, 60_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) fail(`${name}: the server exited with ${code}, expected a non-zero code`);
      if (!reason.test(output)) fail(`${name}: the server exited with ${code} but not for the expected reason:\n${output}`);
      const probe = net.connect(port, '127.0.0.1');
      probe.on('connect', () => { probe.destroy(); fail(`${name}: something is listening on port ${port}`); });
      probe.on('error', () => { console.log(`ok: next start refused ${name} with exit code ${code}`); resolve(); });
    });
  });
}

for (const check of cases) await refuses(check);
