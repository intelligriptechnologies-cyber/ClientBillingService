import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantStore, type AppSession } from '@/lib/tenant-store';
import { tenantContextOf } from '../auth/session-context';

const INVOICE = 'nexio-invoice-001';
let store: ReturnType<typeof createTenantStore>; let admin: AppSession; let user: AppSession; let evo: AppSession; let superadmin: AppSession;

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error('Expected fixture'); return value; }
const attempt = (overrides: Partial<Parameters<typeof store.recordDelivery>[1]> = {}) => ({ invoiceId: INVOICE, to: ['a@acme.example'], cc: [], subject: 'Invoice', status: 'sent' as const, error: '', ...overrides });

beforeEach(async () => { store = createTenantStore(':memory:'); admin = must(await store.authenticate('nexio-admin')); user = must(await store.authenticate('nexio-user')); evo = must(await store.authenticate('evo-admin')); superadmin = must(await store.authenticate('superadmin')); });
afterEach(async () => store.close());

describe('delivery log', () => {
  it('lists an invoice\'s attempts newest first, with who made them', async () => {
    const first = await store.recordDelivery(admin, attempt({ subject: 'First' }));
    const second = await store.recordDelivery(user, attempt({ subject: 'Second', status: 'failed', error: 'The connection timed out (ETIMEDOUT).', cc: ['b@acme.example'], to: ['a@acme.example', 'c@acme.example'] }));
    expect((await store.listDeliveries(admin, INVOICE)).map((row) => row.id)).toEqual([second.id, first.id]);
    expect(second).toMatchObject({ channel: 'email', to: ['a@acme.example', 'c@acme.example'], cc: ['b@acme.example'], status: 'failed', error: 'The connection timed out (ETIMEDOUT).', attemptedBy: user.id, attemptedByName: user.name });
  });

  it('keeps one invoice\'s log apart from another invoice and from another tenant', async () => {
    await store.recordDelivery(admin, attempt());
    expect(await store.listDeliveries(admin, 'nexio-invoice-payment-001')).toEqual([]);
    await expect(store.listDeliveries(evo, INVOICE)).rejects.toThrow(/not found/i);
    await expect(store.recordDelivery(evo, attempt())).rejects.toThrow(/not found/i);
    await expect(store.listDeliveries(admin, 'no-such-invoice')).rejects.toThrow(/not found/i);
    expect(await store.listDeliveries(admin, INVOICE)).toHaveLength(1);
  });

  it('is for tenant members only and rejects a status the log does not know', async () => {
    await expect(store.recordDelivery(superadmin, attempt())).rejects.toThrow();
    await expect(store.listDeliveries(superadmin, INVOICE)).rejects.toThrow();
    await expect(store.recordDelivery(admin, attempt({ status: 'queued' as never }))).rejects.toThrow();
  });
});

describe('additive migration', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'delivery-migration-')); vi.stubEnv('CLIENT_BILLING_SEED_MODE', 'demo'); });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

  it('upgrades a database that predates the delivery log and the SMTP login columns without losing settings', async () => {
    const file = join(directory, 'legacy.sqlite');
    const first = createTenantStore(file); await first.close();
    const legacy = new DatabaseSync(file);
    legacy.exec('DROP TABLE delivery_log; ALTER TABLE tenant_settings DROP COLUMN smtp_user; ALTER TABLE tenant_settings DROP COLUMN smtp_password;');
    legacy.prepare("UPDATE tenant_settings SET smtp_host = 'smtp.old.example', smtp_from = 'old@nexio.example' WHERE tenant_id = 'nexio'").run();
    legacy.close();
    const upgraded = createTenantStore(file);
    try {
      const session = must(await upgraded.authenticate('nexio-admin'));
      expect(await upgraded.getTenantSettings(tenantContextOf(session))).toMatchObject({ smtpHost: 'smtp.old.example', smtpFrom: 'old@nexio.example', smtpUser: '', smtpPasswordSet: false });
      expect((await upgraded.recordDelivery(session, attempt())).status).toBe('sent');
    } finally { await upgraded.close(); }
  });
});
