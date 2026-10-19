// node control-billing.mjs run journeys/email-invoice.mjs --as nexio-admin [--args '{"invoiceId":"nexio-invoice-001"}']
// Saves SMTP settings for the tenant, sends an invoice by email from the invoice detail page and reads back the
// delivery log through the API and the instance database. The instance uses the capture transport, so nothing leaves the machine.
// Selectors come from e2e/invoice-email.spec.ts.
export default async function journey({ page, api, db, shot, args }) {
  const invoiceId = args.invoiceId ?? 'nexio-invoice-001';
  const settings = (await api('GET', '/api/settings')).body.settings;
  const saved = await api('PUT', '/api/settings', { ...settings, smtpHost: 'smtp.nexio.test', smtpFrom: 'billing@nexio.test', smtpUser: 'billing', smtpPassword: 'journey-secret' });
  if (JSON.stringify(saved.body).includes('journey-secret')) throw new Error('The settings API echoed the SMTP password.');

  await page.goto(`/invoices/${invoiceId}`);
  await page.getByRole('button', { name: 'Send by email' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send invoice by email' });
  await dialog.getByLabel('To', { exact: true }).waitFor();
  await dialog.getByLabel('Cc', { exact: true }).fill('accounts@nexio.test');
  await shot('email-dialog');
  await dialog.getByRole('button', { name: 'Send email' }).click();
  await page.getByRole('status').filter({ hasText: 'was emailed to' }).waitFor();
  await page.getByRole('row').filter({ hasText: 'accounts@nexio.test' }).waitFor();
  await shot('deliveries-panel');

  const deliveries = await api('GET', `/api/invoices/${invoiceId}/deliveries`);
  const rows = await db('SELECT status, to_address, cc_address, subject, error, attempted_by FROM delivery_log WHERE invoice_id = ? ORDER BY attempted_at DESC', [invoiceId]);
  return { deliveries: deliveries.body.deliveries, rows: rows.rows };
}
