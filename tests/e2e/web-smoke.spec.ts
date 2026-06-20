import { expect, test } from '@playwright/test';

test('renders the unauthenticated web app shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.login-brand')).toContainText('WikiFlow');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
