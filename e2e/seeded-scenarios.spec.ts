import { expect, test } from '@playwright/test';

const tenants = [
  ['nexio', 'Nexio Hyper'],
  ['maasp', 'MAASP Associates'],
  ['evo', 'Evo Fitness'],
  ['gripdata', 'Gripdata Analytics'],
  ['od', 'OD Badminton'],
] as const;

test('every demo tenant exposes its seeded contract, invoice, payment, and deposit scenario', async ({ page }) => {
  for (const [tenantId, tenantName] of tenants) {
    await page.goto('/');
    await page.getByLabel('Demo identity').selectOption(`${tenantId}-admin`);
    await page.getByRole('button', { name: 'Enter demo' }).click();

    await page.getByRole('link', { name: 'Contracts' }).click();
    await page.waitForURL('**/contracts');
    await expect(page.getByText(`${tenantName} managed billing contract`, { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Invoices' }).click();
    await page.waitForURL('**/invoices');
    await expect(page.getByText(`${tenantName.slice(0, 3).toUpperCase()}-2026-001`, { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Payments' }).click();
    await page.waitForURL('**/payments');
    await expect(page.getByText(`${tenantName} Customer`, { exact: true }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Renewals & deposits' }).click();
    await page.waitForURL('**/renewals');
    await expect(page.getByRole('heading', { name: 'Security-deposit ledger' })).toBeVisible();
    await expect(page.getByText(`${tenantName} Customer`, { exact: true }).last()).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
  }
});
