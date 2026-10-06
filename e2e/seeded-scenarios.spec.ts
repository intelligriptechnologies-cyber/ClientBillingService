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

    await Promise.all([page.waitForURL('**/contracts'), page.getByRole('link', { name: 'Contracts', exact: true }).click()]);
    await expect(page.getByText(`${tenantName} managed billing contract`, { exact: true })).toBeVisible();

    await Promise.all([page.waitForURL('**/invoices'), page.getByRole('link', { name: 'Invoices', exact: true }).click()]);
    await expect(page.getByText(`${tenantName.slice(0, 3).toUpperCase()}-2026-001`, { exact: true })).toBeVisible();

    await Promise.all([page.waitForURL('**/payments'), page.getByRole('link', { name: 'Payments', exact: true }).click()]);
    await expect(page.getByText(`${tenantName} Customer`, { exact: true }).first()).toBeVisible();

    await Promise.all([page.waitForURL('**/renewals'), page.getByRole('link', { name: 'Renewals & deposits', exact: true }).click()]);
    await expect(page.getByRole('heading', { name: 'Security-deposit ledger' })).toBeVisible();
    await expect(page.getByText(`${tenantName} Customer`, { exact: true }).last()).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
  }
});
