import { beforeEach, expect, it } from 'vitest';
import type { DeliveryInput, TenantStore } from '@/lib/tenant-store';
import { tenantContextOf, type Resolution, type TenantContext } from '../auth/principal';
import { describeStore, memberContext, storeForTest } from './test-store';

const INVOICE = 'nexio-invoice-001';

const attempt = (overrides: Partial<DeliveryInput> = {}): DeliveryInput => ({ invoiceId: INVOICE, to: ['a@acme.example'], cc: [], subject: 'Invoice', status: 'sent' as const, error: '', ...overrides });

describeStore('delivery log', () => {
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
    const superadmin: Resolution = { kind: 'platform', actor: { kind: 'platform', username: 'superadmin' }, viewer: { name: 'Demo Superadmin', email: 'superadmin@ledgerly.demo' } };
    expect(() => tenantContextOf(superadmin)).toThrow('tenant');
    await expect(store.recordDelivery(admin, attempt({ status: 'queued' as never }))).rejects.toThrow('Unknown delivery status.');
    expect(await store.listDeliveries(admin, INVOICE)).toEqual([]);
  });
});
