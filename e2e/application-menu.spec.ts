import { expect, test } from '@playwright/test';
import { clickMenuLink } from './navigation';

async function login(page: import('@playwright/test').Page, identity: string) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption(identity);
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await page.waitForURL('**/dashboard');
}

test('ordered groups expand with the keyboard and keep the current destination active on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, 'nexio-admin');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.locator(':scope > a').first()).toHaveText('Dashboard');
  await expect(nav.locator('.nav-parent')).toHaveText(['Master Data⌄', 'Operational Records⌄', 'Billing⌄', 'Reports⌄', 'Admin Console⌄']);
  const master = nav.getByRole('button', { name: 'Master Data' });
  await master.focus(); await page.keyboard.press('Enter');
  await expect(master).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.locator('.nav-group').first().getByRole('link')).toHaveText(['Customers', 'Services', 'Contracts', 'Renewal Tracker']);
  await clickMenuLink(page, 'Billing', 'Security Deposits');
  await expect(page).toHaveURL(/\/security-deposits$/);
  await expect(nav.getByRole('link', { name: 'Security Deposits' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button', { name: 'Billing' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { name: 'Security-deposit ledger' })).toBeVisible();
  expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(nav.getByRole('button', { name: 'Billing' })).toHaveAttribute('aria-expanded', 'true');
  await clickMenuLink(page, 'Reports', 'Pending Payments');
  await expect(page).toHaveURL(/\/reports\/pending-payments$/);
  await expect(page.getByRole('heading', { name: 'Pending Payments', exact: true })).toBeVisible();
  await clickMenuLink(page, 'Admin Console', 'Logs');
  await expect(page.getByRole('heading', { name: 'Operational logs' })).toBeVisible();
});

test('every desktop submenu opens its route in the requested order', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'nexio-admin');
  const groups = [
    ['Master Data', [['Customers', '/customers'], ['Services', '/services'], ['Contracts', '/contracts'], ['Renewal Tracker', '/renewals']]],
    ['Operational Records', [['Additional Services', '/additional-services'], ['Task Notes', '/task-notes']]],
    ['Billing', [['Invoices', '/invoices'], ['Payments', '/payments'], ['Security Deposits', '/security-deposits']]],
    ['Reports', [['GST Sales', '/reports/gst-sales'], ['Pending Payments', '/reports/pending-payments']]],
    ['Admin Console', [['Company Settings', '/settings'], ['User management', '/users'], ['Logs', '/logs']]],
  ] as const;
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const [group, links] of groups) {
    const button = nav.getByRole('button', { name: group, exact: true });
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
    const submenu = button.locator('..').getByRole('link');
    await expect(submenu).toHaveText(links.map(([label]) => label));
    for (const [label, href] of links) {
      await clickMenuLink(page, group, label);
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  }
  for (const [href, heading] of [['/task-notes', 'Task Notes'], ['/security-deposits', 'Security Deposits'], ['/reports/pending-payments', 'Pending Payments'], ['/logs', 'Logs']] as const) {
    await page.goto(href);
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
  }
});

test('task notes support CRUD and tenant isolation', async ({ page }) => {
  await login(page, 'nexio-admin');
  await clickMenuLink(page, 'Operational Records', 'Task Notes');
  await page.getByRole('button', { name: 'Add task note' }).click();
  const form = page.getByRole('form', { name: 'Add task note' });
  await form.getByLabel('Date').fill('2026-10-07');
  await form.getByLabel('Customer').selectOption({ index: 1 });
  await form.getByRole('textbox', { name: 'Note', exact: true }).fill('Discuss renewal terms');
  await form.getByRole('button', { name: 'Save task note' }).click();
  await expect(page.getByText('Discuss renewal terms')).toBeVisible();
  await page.getByLabel('Filter task notes by date').fill('2026-10-08');
  await expect(page.getByText('Discuss renewal terms')).toHaveCount(0);
  await page.getByLabel('Filter task notes by date').fill('2026-10-07');
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByRole('form', { name: 'Edit task note' }).getByRole('textbox', { name: 'Note', exact: true }).fill('Renewal terms confirmed');
  await page.getByRole('form', { name: 'Edit task note' }).getByRole('button', { name: 'Save task note' }).click();
  await expect(page.getByText('Renewal terms confirmed')).toBeVisible();
  const notes = await (await page.request.get('/api/task-notes')).json() as { items: Array<{ id: string; customerId: string }> };
  const noteId = notes.items.find((item) => item.id)?.id;
  const customerId = notes.items.find((item) => item.id)?.customerId;
  expect(noteId).toBeTruthy();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, 'evo-admin');
  expect((await (await page.request.get('/api/task-notes')).json() as { items: unknown[] }).items).toEqual([]);
  const crossTenant = await page.request.put(`/api/task-notes/${noteId}`, { data: { customerId, date: '2026-10-07', note: 'Changed' } });
  expect(crossTenant.status()).toBe(400);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, 'nexio-admin');
  await page.goto('/task-notes');
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete task note' }).click();
  await expect(page.getByText('Renewal terms confirmed')).toHaveCount(0);
});

test('tenant users cannot open admin routes or see admin navigation', async ({ page }) => {
  await login(page, 'nexio-user');
  await expect(page.getByRole('button', { name: 'Admin Console' })).toHaveCount(0);
  for (const path of ['/settings', '/users', '/logs']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard$/);
  }
});
