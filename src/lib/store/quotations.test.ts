import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest } from './test-store';
import { tenantContextOf } from '../auth/session-context';

describeStore(['services', 'quotations'], 'services and quotations', () => {
  it('edits and archives a draft quotation without changing another tenant', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin'); const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected tenant sessions');
    const service = (await store.listServices(tenantContextOf(nexio))).find((item) => item.status === 'active');
    if (!service) throw new Error('Expected active service');
    const quote = await store.createQuotation(tenantContextOf(nexio), { customerName: 'First customer', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 1 }] });
    expect((await store.updateQuotation(tenantContextOf(nexio), quote.id, { customerName: 'Updated customer', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 2 }] })).totalMinor).toBe(service.prices.monthly * 2);
    expect((await store.updateQuotation(tenantContextOf(nexio), quote.id, { status: 'archived' })).status).toBe('archived');
    expect((await store.listQuotations(tenantContextOf(nexio))).find((item) => item.id === quote.id)?.status).toBe('archived');
    await expect(store.updateQuotation(tenantContextOf(evo), quote.id, { status: 'draft' })).rejects.toThrow('does not belong');
  });

  it('persists frequency-aware services and tenant-scoped quotations', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    const service = await store.createService(tenantContextOf(nexio), {
      name: 'Managed analytics',
      description: 'Monthly reporting and advisory',
      prices: { monthly: 150000, quarterly: 420000, halfYearly: 780000, annual: 1440000 },
    });
    const quotation = await store.createQuotation(tenantContextOf(nexio), {
      customerName: 'Acme Trading',
      customerEmail: 'accounts@acme.example',
      lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 2 }],
    });

    expect(await store.listServices(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ id: service.id, prices: { monthly: 150000, quarterly: 420000, halfYearly: 780000, annual: 1440000 } })]));
    expect(quotation).toMatchObject({ customerName: 'Acme Trading', totalMinor: 300000, lines: [expect.objectContaining({ serviceName: 'Managed analytics', unitPriceMinor: 150000 })] });
    expect(await store.listQuotations(tenantContextOf(evo))).toEqual([]);
    await expect(store.getQuotation(tenantContextOf(evo), quotation.id)).rejects.toThrow('tenant');
  });

  it('rejects invalid service prices and quotation lines from another tenant', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const service = await store.createService(tenantContextOf(nexio), { name: 'Reporting', prices: { monthly: 1000, quarterly: 0, halfYearly: 0, annual: 0 } });

    await expect(store.createService(tenantContextOf(nexio), { name: 'Broken', prices: { monthly: -1, quarterly: 0, halfYearly: 0, annual: 0 } })).rejects.toThrow('non-negative');
    await expect(store.createQuotation(tenantContextOf(evo), { customerName: 'Other customer', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 1 }] })).rejects.toThrow('tenant');
  });
});

describeStore(['services', 'quotations'], 'services and quotations under concurrent requests', () => {
  async function warmed() {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.listServices(nexio), store.listServices(nexio)]);
    const service = (await store.listServices(nexio)).find((item) => item.status === 'active');
    if (!service) throw new Error('Expected an active service');
    return { store, nexio, service };
  }

  it('gives two quotations created at once their own numbers', async () => {
    const { store, nexio, service } = await warmed();
    const lines = [{ serviceId: service.id, frequency: 'monthly' as const, quantity: 1 }];

    const created = await Promise.all([store.createQuotation(nexio, { customerName: 'First', lines }), store.createQuotation(nexio, { customerName: 'Second', lines })]);

    expect(new Set(created.map((quotation) => quotation.quoteNumber)).size).toBe(2);
    expect((await store.listQuotations(nexio)).map((quotation) => quotation.quoteNumber).sort()).toEqual(['Q-NEXIO-0001', 'Q-NEXIO-0002']);
  });

  it('keeps both changes when a rename and a price change of one service run at once', async () => {
    const { store, nexio, service } = await warmed();
    const prices = { ...service.prices, monthly: service.prices.monthly + 500 };

    await Promise.all([store.updateService(nexio, service.id, { name: 'Renamed service' }), store.updateService(nexio, service.id, { prices })]);

    expect(await store.getService(nexio, service.id)).toMatchObject({ name: 'Renamed service', prices });
  });

  it('keeps both changes when a line edit and a rename of one quotation run at once', async () => {
    const { store, nexio, service } = await warmed();
    const quotation = await store.createQuotation(nexio, { customerName: 'Before', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 1 }] });
    const lines = [{ serviceId: service.id, frequency: 'monthly' as const, quantity: 3 }, { serviceId: service.id, frequency: 'annual' as const, quantity: 1 }];

    await Promise.all([store.updateQuotation(nexio, quotation.id, { lines }), store.updateQuotation(nexio, quotation.id, { customerName: 'After' })]);

    const saved = await store.getQuotation(nexio, quotation.id);
    expect(saved).toMatchObject({ customerName: 'After', totalMinor: service.prices.monthly * 3 + service.prices.annual });
    expect(saved.lines.map((line) => [line.frequency, line.quantity])).toEqual([['monthly', 3], ['annual', 1]]);
  });
});
