import { expect, it } from 'vitest';
import { describeStore, storeForTest, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';

describeStore(['customers', 'contracts', 'deposits', 'invoices', 'payments'], 'demo seed', () => {
  it('seeds a complete billing scenario for every tenant', async () => {
    const store = await storeForTest();

    for (const tenantId of ['nexio', 'maasp', 'evo', 'gripdata', 'od']) {
      const session = await signIn(store, `${tenantId}-admin`);
      if (!session) throw new Error(`Expected ${tenantId} admin session`);

      const customer = (await store.listCustomers(tenantContextOf(session), {})).items[0];
      const contract = (await store.listContracts(tenantContextOf(session), {})).items[0];
      const invoices = (await store.listInvoices(tenantContextOf(session), {})).items;
      const payments = (await store.listPayments(tenantContextOf(session), {})).items;
      const deposits = await store.listSecurityDeposits(tenantContextOf(session));

      expect(customer).toBeDefined();
      expect(contract).toMatchObject({ customerId: customer?.id, status: 'active' });
      expect(invoices).toEqual(expect.arrayContaining([
        expect.objectContaining({ contractId: contract?.id, customerId: customer?.id }),
      ]));
      expect(payments).toEqual(expect.arrayContaining([
        expect.objectContaining({ customerId: customer?.id, invoiceId: expect.any(String) }),
      ]));
      expect(deposits).toEqual(expect.arrayContaining([
        expect.objectContaining({ contractId: contract?.id, customerId: customer?.id, status: 'held' }),
      ]));
    }
  });
});
