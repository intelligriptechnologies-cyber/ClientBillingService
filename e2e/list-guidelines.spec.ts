import { expect, test, type Page } from '@playwright/test';

async function enter(page: Page, identity: string) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption(identity);
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.waitForURL('**/dashboard');
}

async function checkList(page: Page, route: string) {
  await page.goto(route);
  if (route === '/invoices/bulk') await page.getByRole('button', { name: 'Preview invoices' }).click();
  await expect(page.getByRole('textbox', { name: /search/i }).first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: /month|period/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' }).first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: /rows per page/i }).first()).toBeVisible();
  const tables = await page.locator('table.data-table').count();
  const pagers = await page.getByRole('combobox', { name: /rows per page/i }).count();
  expect(tables, `${route} should render a data table`).toBeGreaterThan(0);
  expect(pagers).toBeGreaterThanOrEqual(2 * tables);
  expect(pagers % 2).toBe(0);
}

test('tenant list screens have search, period, clear, and paired table pagers', async ({ page }) => {
  await enter(page, 'nexio-admin');
  for (const route of ['/customers', '/services', '/contracts', '/renewals', '/additional-services', '/task-notes', '/invoices', '/invoices/bulk', '/payments', '/security-deposits', '/reports/pending-payments', '/reports/gst-sales', '/users', '/logs']) {
    await checkList(page, route);
  }
});

test('the platform tenant list has search, period, clear, and paired pagers', async ({ page }) => {
  await enter(page, 'superadmin');
  await checkList(page, '/tenants');
});
