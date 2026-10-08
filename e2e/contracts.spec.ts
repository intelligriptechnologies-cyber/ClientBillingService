import { clickMenuLink } from './navigation';
import { expect, test } from '@playwright/test';

async function enterNexio(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await clickMenuLink(page, 'Master Data', 'Contracts');
}

test('a tenant creates a quarterly contract and its schedule is visible', async ({ page }) => {
  await enterNexio(page);
  await page.getByRole('button', { name: 'Add contract' }).click();
  await page.getByLabel('Contract name').fill('Quarterly reporting');
  await page.getByLabel('Customer').selectOption({ index: 1 });
  await page.getByLabel('Start date').fill('2026-04-01');
  await page.getByLabel('End date').fill('2027-03-31');
  await page.getByLabel('Contract value').fill('12000');
  await page.getByLabel('Billing frequency').selectOption('quarterly');
  await page.getByText('Jan', { exact: true }).click();
  await page.getByText('Apr', { exact: true }).click();
  await page.getByText('Jul', { exact: true }).click();
  await page.getByLabel('Security deposit').fill('2500');
  await page.getByLabel('Select services').click();
  await page.getByRole('group', { name: 'Services' }).getByRole('checkbox').first().check();
  await page.getByLabel('Select services').click();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page.getByText('Quarterly reporting', { exact: true })).toBeVisible();
  await expect(page.getByText(/months 1, 4, 7/)).toBeVisible();
});

test('quarterly contracts require exactly three invoice months', async ({ page }) => {
  await enterNexio(page);
  await page.getByRole('button', { name: 'Add contract' }).click();
  await page.getByLabel('Contract name').fill('Invalid quarterly contract');
  await page.getByLabel('Customer').selectOption({ index: 1 });
  await page.getByLabel('Start date').fill('2026-04-01');
  await page.getByLabel('End date').fill('2027-03-31');
  await page.getByLabel('Contract value').fill('12000');
  await page.getByLabel('Billing frequency').selectOption('quarterly');
  await page.getByText('Jan', { exact: true }).click();
  await page.getByLabel('Select services').click();
  await page.getByRole('group', { name: 'Services' }).getByRole('checkbox').first().check();
  await page.getByLabel('Select services').click();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page.getByText('Quarterly contracts require 3 invoice months.')).toBeVisible();
});


test('new contracts generate names and dates, while preserving manual entries', async ({ page }) => {
  await enterNexio(page);
  const customerResponse = await page.request.post('/api/customers', { data: { companyName: 'Arbor Test Customer', contactName: 'Aarav Mehta', email: 'aarav.contract@example.com', phone: '9000000123', gstin: '', billingAddress: 'Bengaluru', invoiceDelivery: 'monthly' } });
  expect(customerResponse.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Add contract' }).click();
  const name = page.getByLabel('Contract name');
  const endDate = page.getByLabel('End date');
  const reviewDate = page.getByLabel('Escalation review date');
  await page.getByLabel('Customer').selectOption({ label: 'Nexio Hyper Customer' });
  await expect(name).toHaveValue('Billing - Nexio v1 monthly');
  await page.getByLabel('Billing frequency').selectOption('quarterly');
  await expect(name).toHaveValue('Billing - Nexio v1 quarterly');
  await page.getByLabel('Billing frequency').selectOption('halfYearly');
  await expect(name).toHaveValue('Billing - Nexio v1 halfyearly');
  await page.getByLabel('Billing frequency').selectOption('quarterly');
  await page.getByLabel('Customer').selectOption({ label: 'Arbor Test Customer' });
  await expect(name).toHaveValue('Aarav - Nexio v1 quarterly');
  await name.fill('Custom agreement');
  await page.getByLabel('Billing frequency').selectOption('annual');
  await page.getByLabel('Customer').selectOption({ label: 'Nexio Hyper Customer' });
  await expect(name).toHaveValue('Custom agreement');
  await name.clear();
  await expect(name).toHaveValue('Billing - Nexio v1 annual');
  await page.getByLabel('Customer').selectOption({ label: 'Arbor Test Customer' });
  await expect(name).toHaveValue('Aarav - Nexio v1 annual');

  await page.getByLabel('Start date').fill('2026-04-15');
  await expect(endDate).toHaveValue('2027-03-31');
  await expect(reviewDate).toHaveValue('2027-02-01');
  await page.getByLabel('Start date').fill('2026-12-20');
  await expect(endDate).toHaveValue('2027-11-30');
  await expect(reviewDate).toHaveValue('2027-10-01');
  await endDate.fill('2028-01-31');
  await page.getByLabel('Start date').fill('2027-01-01');
  await expect(endDate).toHaveValue('2028-01-31');
  await expect(reviewDate).toHaveValue('2027-11-01');
  await reviewDate.fill('2027-09-05');
  await page.getByLabel('Start date').fill('2027-02-10');
  await expect(endDate).toHaveValue('2028-01-31');
  await expect(reviewDate).toHaveValue('2027-09-05');
});

test('the service dropdown saves selections on create and edit', async ({ page }) => {
  await enterNexio(page);
  const extraService = `Contract support ${Date.now()}`;
  const serviceResponse = await page.request.post('/api/services', { data: { name: extraService, description: '', prices: { monthly: 10000, quarterly: 30000, halfYearly: 60000, annual: 120000 } } });
  expect(serviceResponse.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Add contract' }).click();
  await page.getByLabel('Contract name').fill(`Service selection ${Date.now()}`);
  const contractName = await page.getByLabel('Contract name').inputValue();
  await page.getByLabel('Customer').selectOption({ index: 1 });
  await page.getByLabel('Start date').fill('2026-04-15');
  await page.getByLabel('Contract value').fill('12000');
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page.getByText('Select at least one service.')).toBeVisible();
  await page.getByLabel('Select services').click();
  await page.getByRole('group', { name: 'Services' }).getByLabel('Managed billing service').check();
  await page.getByRole('group', { name: 'Services' }).getByLabel(extraService).check();
  const selected = page.getByLabel('Selected services');
  await expect(selected).toContainText('Managed billing service');
  await expect(selected).toContainText(extraService);
  await page.getByLabel('Select services').click();
  await page.getByRole('button', { name: 'Create contract' }).click();
  const row = page.getByRole('row', { name: new RegExp(contractName) });
  await expect(row).toContainText('Managed billing service');
  await expect(row).toContainText(extraService);
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Contract name')).toHaveValue(contractName);
  await expect(page.getByLabel('End date')).toHaveValue('2027-03-31');
  await expect(page.getByLabel('Escalation review date')).toHaveValue('2027-02-01');
  await page.getByLabel('Start date').fill('2026-05-01');
  await expect(page.getByLabel('End date')).toHaveValue('2027-03-31');
  await expect(page.getByLabel('Escalation review date')).toHaveValue('2027-02-01');
  await page.getByLabel('Billing frequency').selectOption('quarterly');
  await expect(page.getByLabel('Contract name')).toHaveValue(contractName);
  await page.getByLabel('Billing frequency').selectOption('monthly');
  await page.getByRole('button', { name: 'Remove Managed billing service' }).click();
  await expect(page.getByLabel('Selected services')).not.toContainText('Managed billing service');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row).not.toContainText('Managed billing service');
  await expect(row).toContainText(extraService);
});
