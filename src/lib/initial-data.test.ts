import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createTenantStore } from './tenant-store';

it('starts a new app database with every saved record and keeps later edits on reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'client-billing-initial-data-'));
  const filename = join(directory, 'app.sqlite');
  const previousSeedMode = process.env.CLIENT_BILLING_SEED_MODE;
  delete process.env.CLIENT_BILLING_SEED_MODE;

  try {
    const initial = new DatabaseSync(resolve('seed', 'initial-data.sqlite'));
    let store = createTenantStore(filename);
    await store.close();

    const copy = new DatabaseSync(filename);
    const tableNames = (initial.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect((copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)).toEqual(tableNames);
    for (const table of tableNames) {
      expect(copy.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(initial.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all());
    }
    copy.close();
    initial.close();

    store = createTenantStore(filename);
    const session = await store.authenticate('nexio-admin');
    if (!session) throw new Error('Expected saved Nexio admin');
    await store.createCustomer(session, { companyName: 'After first open', contactName: 'New Contact', email: 'new@example.com', phone: '1234567890', gstin: '', billingAddress: 'New address', invoiceDelivery: 'monthly' });
    await store.close();

    store = createTenantStore(filename);
    expect((await store.listCustomers(session, { search: 'After first open' })).items).toHaveLength(1);
    expect((await store.listInvoices(session, {})).items).toHaveLength(0);
    await store.close();
  } finally {
    if (previousSeedMode === undefined) delete process.env.CLIENT_BILLING_SEED_MODE;
    else process.env.CLIENT_BILLING_SEED_MODE = previousSeedMode;
    rmSync(directory, { recursive: true, force: true });
  }
});
