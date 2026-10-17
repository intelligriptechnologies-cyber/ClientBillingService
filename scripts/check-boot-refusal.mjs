// Run after `npm run build`. `next start` must exit non-zero when demo auth is asked for in production
// (ADR 0002, unit A1). Never port 3000: a developer's own dev server owns it.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

const port = Number(process.argv[2] ?? process.env.CLIENT_BILLING_BOOT_CHECK_PORT ?? 3212);
if (port === 3000) throw new Error('Refusing to use port 3000.');
const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
const env = { ...process.env, CLIENT_BILLING_ENV: 'production', CLIENT_BILLING_AUTH_MODE: 'demo', CLIENT_BILLING_DATABASE: ':memory:' };

const child = spawn(process.execPath, [next, 'start', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
const timer = setTimeout(() => { child.kill(); fail('the server was still running after 60 seconds'); }, 60_000);

child.on('exit', (code) => {
  clearTimeout(timer);
  if (code === 0 || code === null) fail(`the server exited with ${code}, expected a non-zero code`);
  if (!/Refusing to start: .*demo.*production/i.test(output)) fail(`the server exited with ${code} but not for the expected reason:\n${output}`);
  const probe = net.connect(port, '127.0.0.1');
  probe.on('connect', () => { probe.destroy(); fail(`something is listening on port ${port}`); });
  probe.on('error', () => { console.log(`ok: next start refused production + demo with exit code ${code}`); });
});

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
