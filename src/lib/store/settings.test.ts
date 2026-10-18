import { expect, it } from 'vitest';
import { describeStore, storeForTest } from './test-store';

describeStore(['settings'], 'tenant settings and operational logs', () => {
  it('persists complete tenant settings, template previews, and isolated operational logs', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin'); const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const saved = await store.updateTenantSettings(nexio, {
      companyName: 'Nexio Billing Services', gstin: '29AAGCB7383J1Z4', address: '42 Ledger Lane, Bengaluru',
      invoicePrefix: 'NX', paymentTermsDays: 21, footer: 'Thank you for your business.',
      invoiceTemplate: 'Invoice {{invoiceNumber}} for {{customerName}}', emailSubject: 'Your invoice {{invoiceNumber}}',
      emailBody: 'Hello {{customerName}}, please find your invoice attached.', smtpHost: 'smtp.demo.local', smtpPort: 2525,
      smtpFrom: 'billing@nexio.example', logRetentionDays: 30, logoDataUrl: 'data:image/png;base64,logo', stampDataUrl: '', signatureDataUrl: 'data:image/png;base64,signature',
    });

    expect(saved.companyName).toBe('Nexio Billing Services');
    expect(await store.getTenantSettings(nexio)).toMatchObject({ invoicePrefix: 'NX', logoDataUrl: 'data:image/png;base64,logo' });
    expect(await store.previewTenantTemplate(nexio)).toContain('Invoice NX-2026-001 for Acme Industries');
    expect((await store.listOperationalLogs(nexio)).some((log) => log.kind === 'feature-flow')).toBe(true);
    expect(await store.listOperationalLogs(evo)).toEqual([]);
  });

  it('keeps settings and operational logs restricted to tenant admins', async () => {
    const store = await storeForTest();
    const tenantUser = await store.authenticate('nexio-user');
    if (!tenantUser) throw new Error('Expected seeded session');

    await expect(store.getTenantSettings(tenantUser)).rejects.toThrow('admin');
    await expect(store.listOperationalLogs(tenantUser)).rejects.toThrow('admin');
  });
});
