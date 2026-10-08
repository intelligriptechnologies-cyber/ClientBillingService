import { expect, type Page } from '@playwright/test';

export async function clickMenuLink(page: Page, group: string, label: string) {
  const parent = page.getByRole('button', { name: group, exact: true });
  if (await parent.getAttribute('aria-expanded') !== 'true') await parent.click();
  const link = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: label, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
}
