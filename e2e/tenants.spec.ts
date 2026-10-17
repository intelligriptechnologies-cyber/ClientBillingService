import { expect, test, type Page } from '@playwright/test';

async function enter(page: Page, identity: string) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption(identity);
  await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Enter demo' }).click()]);
}

async function signOut(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 2_000 });
  }).toPass();
}

test('superadmin can create, filter, and disable a tenant', async ({ page }) => {
  const tenantName = `Northstar ${Date.now()}`;
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('superadmin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.getByRole('link', { name: 'Tenants' }).click();

  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await page.getByRole('button', { name: 'Create tenant' }).click();
  await page.getByLabel('Tenant name').fill(tenantName);
  await page.getByRole('button', { name: 'Create tenant' }).last().click();
  await expect(page.getByRole('cell', { name: new RegExp(tenantName) })).toBeVisible();

  await page.getByLabel('Search tenants').fill(tenantName);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/tenants?') && response.request().method() === 'GET'),
    page.getByRole('button', { name: 'Apply filters' }).click(),
  ]);
  await expect(page.getByRole('cell', { name: new RegExp(tenantName) })).toBeVisible();
  await page.getByRole('row', { name: new RegExp(tenantName) }).getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Disable tenant?' })).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/tenants/') && response.request().method() === 'PATCH'),
    page.getByRole('alertdialog').getByRole('button', { name: 'Disable tenant' }).click(),
  ]);
  await expect(page.getByRole('row', { name: new RegExp(tenantName) }).getByText('disabled')).toBeVisible();
});

test('tenant admin cannot access platform tenant lifecycle management', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.goto('/tenants');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('superadmin renames a tenant, suspends and reactivates it, and the history records each step', async ({ page, browser }) => {
  const stamp = Date.now();
  const tenantName = `Lifecycle ${stamp}`;
  const renamed = `Lifecycle Renamed ${stamp}`;
  await enter(page, 'superadmin');
  await page.getByRole('link', { name: 'Tenants' }).click();
  await page.getByRole('button', { name: 'Create tenant' }).click();
  await page.getByLabel('Tenant name').fill(tenantName);
  await page.getByRole('button', { name: 'Create tenant' }).last().click();
  const row = (name: string) => page.getByRole('row', { name: new RegExp(name) });
  await expect(row(tenantName)).toBeVisible();
  const tenantId = (await row(tenantName).locator('.subtle').first().innerText()).trim();

  await row(tenantName).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Tenant name').fill(renamed);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row(renamed)).toBeVisible();

  const tenantContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const tenantPage = await tenantContext.newPage();
  await enter(tenantPage, `${tenantId}-admin`);

  await row(renamed).getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disable tenant' }).click();
  await expect(row(renamed).getByText('disabled')).toBeVisible();
  await tenantPage.goto('/customers');
  await expect(tenantPage).toHaveURL(/\/$/);
  await tenantContext.close();

  await row(renamed).getByRole('button', { name: 'Approve' }).click();
  await expect(row(renamed).getByText('active', { exact: true })).toBeVisible();

  await row(renamed).getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('dialog', { name: new RegExp(`${renamed} history`) });
  await expect(history.locator('strong')).toHaveText(['created', 'updated', 'disabled', 'enabled']);
});

test('a failed tenant dialog does not leak its error into the next dialog', async ({ page }) => {
  await enter(page, 'superadmin');
  await page.getByRole('link', { name: 'Tenants' }).click();
  await page.getByRole('button', { name: 'Create tenant' }).click();
  await page.getByLabel('Tenant name').fill('Nexio Hyper');
  await page.getByRole('button', { name: 'Create tenant' }).last().click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already exists');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});

test('a failed enable or disable keeps its error visible', async ({ page }) => {
  await enter(page, 'superadmin');
  await page.getByRole('link', { name: 'Tenants' }).click();
  await page.route('**/api/tenants/*', async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 400, json: { message: 'Tenant could not be changed right now.' } });
    else await route.continue();
  });
  await page.getByRole('row', { name: /Nexio Hyper/ }).getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disable tenant' }).click();
  await expect(page.locator('p.form-error')).toContainText('could not be changed');
});

test('platform pages are closed to signed-out visitors and tenant sessions, and the superadmin has no tenant user page', async ({ page }) => {
  await page.goto('/tenants');
  await expect(page).toHaveURL(/\/$/);
  await enter(page, 'nexio-admin');
  expect((await page.request.get('/api/tenants')).status()).toBe(403);
  await signOut(page);
  await enter(page, 'superadmin');
  await page.goto('/users');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(/Subsequent slices add/)).toHaveCount(0);
  await signOut(page);
  await page.goto('/tenants');
  await expect(page).toHaveURL(/\/$/);
});

test('the last active admin of a tenant cannot be disabled from the users page', async ({ page }) => {
  await enter(page, 'evo-admin');
  await page.goto('/users');
  const admins = page.getByRole('row').filter({ hasText: 'Tenant admin' });
  await expect(admins).toHaveCount(1);
  await admins.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('p.form-error')).toContainText('at least one active admin');
});
