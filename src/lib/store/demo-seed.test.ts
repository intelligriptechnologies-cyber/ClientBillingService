import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';
import { validateGstin, validateHsnSac } from '../gst';
import { resolveSupply } from '../invoice-gst';
import { renderInvoiceHtml } from '../invoice-html';

const SELLERS = ['nexio', 'maasp', 'evo', 'gripdata', 'od'];

describeStore('demo sellers and their invoices', () => {
  it('registers every seller with a checksum-valid GSTIN that is its own and starts with its state code', async () => {
    const store = await storeForTest();
    const gstins = new Set<string>();

    for (const tenantId of SELLERS) {
      const settings = await store.getTenantSettings(await memberContext(store, `${tenantId}-admin`));
      const check = validateGstin(settings.gstin);
      expect(check, tenantId).toMatchObject({ ok: true, registered: true });
      expect(settings.stateCode, tenantId).toBe(settings.gstin.slice(0, 2));
      gstins.add(settings.gstin);
    }

    expect(gstins.size).toBe(SELLERS.length);
  });

  it('seeds every invoice as a Tax Invoice that follows the seller, split and HSN rules, and files it under B2B', async () => {
    const store = await storeForTest();

    for (const tenantId of SELLERS) {
      const context = await memberContext(store, `${tenantId}-admin`);
      const settings = await store.getTenantSettings(context);
      const customer = (await store.listCustomers(context)).items[0];
      const supply = resolveSupply(settings.stateCode, { gstin: customer.gstin, stateCode: customer.stateCode });
      const invoices = (await store.listInvoices(context, { pageSize: 100 })).items;
      expect(invoices.length, tenantId).toBeGreaterThanOrEqual(2);

      for (const invoice of invoices) {
        const { snapshot } = invoice;
        expect(snapshot, invoice.invoiceNumber).toMatchObject({ documentType: 'Tax Invoice', hsnRequired: true, gstin: settings.gstin, sellerStateCode: settings.stateCode, placeOfSupplyStateCode: supply.placeOfSupplyStateCode, taxSplit: supply.taxSplit, customerGstin: customer.gstin });
        expect(snapshot.lines?.length, invoice.invoiceNumber).toBeGreaterThan(0);
        for (const line of snapshot.lines ?? []) {
          expect(line.taxType, invoice.invoiceNumber).toBe(supply.expectedTaxType);
          expect(validateHsnSac(line.hsnSac ?? ''), invoice.invoiceNumber).toMatchObject({ ok: true });
        }
        expect(snapshot.lines?.reduce((sum, line) => sum + line.gstMinor, 0), invoice.invoiceNumber).toBe(invoice.gstMinor);
        expect(snapshot.lines?.reduce((sum, line) => sum + line.amountMinor, 0), invoice.invoiceNumber).toBe(invoice.taxableMinor);
        expect(renderInvoiceHtml(invoice), invoice.invoiceNumber).toMatch(/>HSN\/SAC<\/th>/);
      }

      const register = await store.getGstSalesReport(context, '2026-10');
      expect(register.items.length, tenantId).toBeGreaterThan(0);
      for (const row of register.items) expect(row.section, `${tenantId} ${row.invoiceNumber}`).toBe('B2B');
    }
  });

  it('gives every seeded service a valid HSN/SAC code, so a bulk run can issue GST', async () => {
    const store = await storeForTest();

    for (const tenantId of SELLERS) {
      const services = await store.listServices(await memberContext(store, `${tenantId}-admin`));
      expect(services.length, tenantId).toBeGreaterThan(0);
      for (const service of services) expect(validateHsnSac(service.hsnSac), `${tenantId} ${service.name}`).toMatchObject({ ok: true });
    }
  });
});

describeStore('demo seed', () => {
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
