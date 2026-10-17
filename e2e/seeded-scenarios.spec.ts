import { clickMenuLink } from './navigation';
import { expect, test } from '@playwright/test';

const tenants = [
  ['nexio', 'Nexio Hyper'],
  ['maasp', 'MAASP Associates'],
  ['evo', 'Evo Fitness'],
  ['gripdata', 'Gripdata Analytics'],
  ['od', 'OD Badminton'],
] as const;

test('every demo tenant exposes its seeded contract, invoice, payment, and deposit scenario', async ({ page }) => {
  test.setTimeout(180_000);
  for (const [tenantId, tenantName] of tenants) {
    await page.goto('/');
    await page.getByLabel('Demo identity').selectOption(`${tenantId}-admin`);
    await page.getByRole('button', { name: 'Enter demo' }).click();

    await clickMenuLink(page, 'Master Data', 'Contracts');
    await expect(page.getByText(`${tenantName} managed billing contract`, { exact: true })).toBeVisible();

    await clickMenuLink(page, 'Billing', 'Invoices');
    await expect(page.getByText(`${tenantName.slice(0, 3).toUpperCase()}-2026-001`, { exact: true })).toBeVisible();

    await clickMenuLink(page, 'Billing', 'Payments');
    await expect(page.getByRole('cell', { name: `${tenantName} Customer`, exact: true }).first()).toBeVisible();

    await clickMenuLink(page, 'Master Data', 'Renewal Tracker');
    await expect(page.getByRole('heading', { name: 'Renewal tracker', level: 1 })).toBeVisible();
    await clickMenuLink(page, 'Billing', 'Security Deposits');
    await expect(page.getByRole('heading', { name: 'Security-deposit ledger' })).toBeVisible();
    await expect(page.getByText(`${tenantName} Customer`, { exact: true }).last()).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
  }
});
