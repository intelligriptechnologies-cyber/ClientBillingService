import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantStore, type AppSession, type DeliveryInput, type TenantStore } from '@/lib/tenant-store';
import type { TenantContext } from '../auth/principal';
import { tenantContextOf } from '../auth/session-context';
import { describeStore, memberContext, storeForTest } from './test-store';

const INVOICE = 'nexio-invoice-001';

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error('Expected fixture'); return value; }
const attempt = (overrides: Partial<DeliveryInput> = {}): DeliveryInput => ({ invoiceId: INVOICE, to: ['a@acme.example'], cc: [], subject: 'Invoice', status: 'sent' as const, error: '', ...overrides });

describeStore(['users', 'invoices'], 'delivery log', () => {
  let store: TenantStore; let admin: TenantContext; let user: TenantContext; let evo: TenantContext;
  beforeEach(async () => { store = await storeForTest(); admin = await memberContext(store, 'nexio-admin'); user = await memberContext(store, 'nexio-user'); evo = await memberContext(store, 'evo-admin'); });

  it('lists an invoice\'s attempts newest first, with who made them', async () => {
    const first = await store.recordDelivery(admin, attempt({ subject: 'First' }));
    const second = await store.recordDelivery(user, attempt({ subject: 'Second', status: 'failed', error: 'The connection timed out (ETIMEDOUT).', cc: ['b@acme.example'], to: ['a@acme.example', 'c@acme.example'] }));
    expect((await store.listDeliveries(admin, INVOICE)).map((row) => row.id)).toEqual([second.id, first.id]);
    expect(second).toMatchObject({ channel: 'email', to: ['a@acme.example', 'c@acme.example'], cc: ['b@acme.example'], status: 'failed', error: 'The connection timed out (ETIMEDOUT).', attemptedBy: 'nexio-user', attemptedByName: 'Nexio Hyper User' });
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
    const superadmin: AppSession = { id: 'superadmin', name: 'Demo Superadmin', email: 'superadmin@ledgerly.demo', role: 'superadmin', tenantId: null, tenantName: null };
    expect(() => tenantContextOf(superadmin)).toThrow('tenant');
    await expect(store.recordDelivery(admin, attempt({ status: 'queued' as never }))).rejects.toThrow('Unknown delivery status.');
    expect(await store.listDeliveries(admin, INVOICE)).toEqual([]);
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
      expect((await upgraded.recordDelivery(tenantContextOf(session), attempt())).status).toBe('sent');
    } finally { await upgraded.close(); }
  });
});
