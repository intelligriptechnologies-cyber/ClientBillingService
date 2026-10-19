import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';

describeStore('task notes', () => {
  it('creates, filters, edits, and deletes task notes within the tenant', async () => {
    const store = await storeForTest();
    const nexio = await signIn(store, 'nexio-admin'); const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected tenant sessions');
    const nexioCustomer = (await store.listCustomers(tenantContextOf(nexio))).items[0]; const evoCustomer = (await store.listCustomers(tenantContextOf(evo))).items[0];
    const input = { customerId: nexioCustomer.id, date: '2026-10-07', note: 'Call customer about renewal' };
    await expect(store.createTaskNote(tenantContextOf(nexio), { ...input, customerId: evoCustomer.id })).rejects.toThrow('does not belong');
    await expect(store.createTaskNote(tenantContextOf(nexio), { ...input, date: '2026-02-30' })).rejects.toThrow('valid date');
    const created = await store.createTaskNote(tenantContextOf(nexio), input);
    expect(await store.listTaskNotes(tenantContextOf(nexio), { date: input.date, customerId: nexioCustomer.id })).toMatchObject([created]);
    expect(await store.listTaskNotes(tenantContextOf(nexio), { date: '2026-10-08' })).toEqual([]);
    expect(await store.listTaskNotes(tenantContextOf(evo))).toEqual([]);
    await expect(store.updateTaskNote(tenantContextOf(evo), created.id, { ...input, customerId: evoCustomer.id, note: 'Changed' })).rejects.toThrow('not found');
    await expect(store.updateTaskNote(tenantContextOf(nexio), created.id, { ...input, customerId: evoCustomer.id })).rejects.toThrow('does not belong');
    expect((await store.updateTaskNote(tenantContextOf(nexio), created.id, { ...input, note: 'Followed up' })).note).toBe('Followed up');
    await expect(store.deleteTaskNote(tenantContextOf(evo), created.id)).rejects.toThrow('not found');
    await store.deleteTaskNote(tenantContextOf(nexio), created.id);
    expect(await store.listTaskNotes(tenantContextOf(nexio))).toEqual([]);
  });
});

describeStore('task note lists', () => {
  it('filters notes by customer and orders them by date', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    const seeded = (await store.listCustomers(nexio)).items[0];
    const other = await store.createCustomer(nexio, { companyName: 'Other buyer', contactName: 'Contact', email: 'o@example.com', phone: '1', gstin: '', billingAddress: 'Somewhere', invoiceDelivery: 'manual' });
    const early = await store.createTaskNote(nexio, { customerId: seeded.id, date: '2026-10-01', note: 'Early' });
    const late = await store.createTaskNote(nexio, { customerId: seeded.id, date: '2026-10-09', note: 'Late' });
    const elsewhere = await store.createTaskNote(nexio, { customerId: other.id, date: '2026-10-05', note: 'Elsewhere' });

    expect((await store.listTaskNotes(nexio, { customerId: seeded.id })).map((item) => item.id)).toEqual([late.id, early.id]);
    expect((await store.listTaskNotes(nexio)).map((item) => item.id)).toEqual([late.id, elsewhere.id, early.id]);
    expect((await store.listTaskNotes(nexio, { customerId: other.id })).map((item) => item.customerName)).toEqual(['Other buyer']);
  });
});