import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantStore, type AppSession } from '@/lib/tenant-store';

const INVOICE = 'nexio-invoice-001';
let store: ReturnType<typeof createTenantStore>; let admin: AppSession; let user: AppSession; let evo: AppSession; let superadmin: AppSession;

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error('Expected fixture'); return value; }
const attempt = (overrides: Partial<Parameters<typeof store.recordDelivery>[1]> = {}) => ({ invoiceId: INVOICE, to: ['a@acme.example'], cc: [], subject: 'Invoice', status: 'sent' as const, error: '', ...overrides });

beforeEach(() => { store = createTenantStore(':memory:'); admin = must(store.authenticate('nexio-admin')); user = must(store.authenticate('nexio-user')); evo = must(store.authenticate('evo-admin')); superadmin = must(store.authenticate('superadmin')); });
afterEach(() => store.close());

describe('delivery log', () => {
  it('lists an invoice\'s attempts newest first, with who made them', () => {
    const first = store.recordDelivery(admin, attempt({ subject: 'First' }));
    const second = store.recordDelivery(user, attempt({ subject: 'Second', status: 'failed', error: 'The connection timed out (ETIMEDOUT).', cc: ['b@acme.example'], to: ['a@acme.example', 'c@acme.example'] }));
    expect(store.listDeliveries(admin, INVOICE).map((row) => row.id)).toEqual([second.id, first.id]);
    expect(second).toMatchObject({ channel: 'email', to: ['a@acme.example', 'c@acme.example'], cc: ['b@acme.example'], status: 'failed', error: 'The connection timed out (ETIMEDOUT).', attemptedBy: user.id, attemptedByName: user.name });
  });

  it('keeps one invoice\'s log apart from another invoice and from another tenant', () => {
    store.recordDelivery(admin, attempt());
    expect(store.listDeliveries(admin, 'nexio-invoice-payment-001')).toEqual([]);
    expect(() => store.listDeliveries(evo, INVOICE)).toThrow(/not found/i);
    expect(() => store.recordDelivery(evo, attempt())).toThrow(/not found/i);
    expect(() => store.listDeliveries(admin, 'no-such-invoice')).toThrow(/not found/i);
    expect(store.listDeliveries(admin, INVOICE)).toHaveLength(1);
  });

  it('is for tenant members only and rejects a status the log does not know', () => {
    expect(() => store.recordDelivery(superadmin, attempt())).toThrow();
    expect(() => store.listDeliveries(superadmin, INVOICE)).toThrow();
    expect(() => store.recordDelivery(admin, attempt({ status: 'queued' as never }))).toThrow();
  });
});

describe('additive migration', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'delivery-migration-')); vi.stubEnv('CLIENT_BILLING_SEED_MODE', 'demo'); });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

  it('upgrades a database that predates the delivery log and the SMTP login columns without losing settings', () => {
    const file = join(directory, 'legacy.sqlite');
    const first = createTenantStore(file); first.close();
    const legacy = new DatabaseSync(file);
    legacy.exec('DROP TABLE delivery_log; ALTER TABLE tenant_settings DROP COLUMN smtp_user; ALTER TABLE tenant_settings DROP COLUMN smtp_password;');
    legacy.prepare("UPDATE tenant_settings SET smtp_host = 'smtp.old.example', smtp_from = 'old@nexio.example' WHERE tenant_id = 'nexio'").run();
    legacy.close();
    const upgraded = createTenantStore(file);
    try {
      const session = must(upgraded.authenticate('nexio-admin'));
      expect(upgraded.getTenantSettings(session)).toMatchObject({ smtpHost: 'smtp.old.example', smtpFrom: 'old@nexio.example', smtpUser: '', smtpPasswordSet: false });
      expect(upgraded.recordDelivery(session, attempt()).status).toBe('sent');
    } finally { upgraded.close(); }
  });
});
