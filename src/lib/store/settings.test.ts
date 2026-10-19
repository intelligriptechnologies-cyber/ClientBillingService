import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, signIn } from './test-store';
import { settingsInput } from '../test-helpers';
import { tenantContextOf } from '../auth/principal';

describeStore('tenant settings and operational logs', () => {
  it('persists complete tenant settings, template previews, and isolated operational logs', async () => {
    const store = await storeForTest(); const nexio = await signIn(store, 'nexio-admin'); const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const saved = await store.updateTenantSettings(tenantContextOf(nexio), {
      companyName: 'Nexio Billing Services', gstin: '29AAGCB7383J1Z4', address: '42 Ledger Lane, Bengaluru',
      invoicePrefix: 'NX', paymentTermsDays: 21, footer: 'Thank you for your business.',
      invoiceTemplate: 'Invoice {{invoiceNumber}} for {{customerName}}', emailSubject: 'Your invoice {{invoiceNumber}}',
      emailBody: 'Hello {{customerName}}, please find your invoice attached.', smtpHost: 'smtp.demo.local', smtpPort: 2525,
      smtpFrom: 'billing@nexio.example', logRetentionDays: 30, logoDataUrl: 'data:image/png;base64,logo', stampDataUrl: '', signatureDataUrl: 'data:image/png;base64,signature',
    });

    expect(saved.companyName).toBe('Nexio Billing Services');
    expect(await store.getTenantSettings(tenantContextOf(nexio))).toMatchObject({ invoicePrefix: 'NX', logoDataUrl: 'data:image/png;base64,logo' });
    expect(await store.previewTenantTemplate(tenantContextOf(nexio))).toContain('Invoice NX-2026-001 for Acme Industries');
    expect((await store.listOperationalLogs(tenantContextOf(nexio))).some((log) => log.kind === 'feature-flow')).toBe(true);
    expect(await store.listOperationalLogs(tenantContextOf(evo))).toEqual([]);
  });

  it('keeps settings and operational logs restricted to tenant admins', async () => {
    const store = await storeForTest();
    const tenantUser = await signIn(store, 'nexio-user');
    if (!tenantUser) throw new Error('Expected seeded session');

    await expect(store.getTenantSettings(tenantContextOf(tenantUser))).rejects.toThrow('admin');
    await expect(store.listOperationalLogs(tenantContextOf(tenantUser))).rejects.toThrow('admin');
  });
});

describeStore('tenant settings under concurrent requests', () => {
  it('keeps the legal name one save sets when another save that leaves it out runs at the same time', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    const { legalName, ...withoutLegalName } = settingsInput(await store.getTenantSettings(nexio));
    expect(legalName).toBe('');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.getTenantSettings(nexio), store.getTenantSettings(nexio)]);

    await Promise.all([
      store.updateTenantSettings(nexio, { ...withoutLegalName, legalName: 'Nexio Hyper Private Limited' }),
      store.updateTenantSettings(nexio, { ...withoutLegalName, footer: 'Paid with thanks.' }),
    ]);

    expect(await store.getTenantSettings(nexio)).toMatchObject({ legalName: 'Nexio Hyper Private Limited' });
  });
});
