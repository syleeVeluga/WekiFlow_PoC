import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TITLE = 'Remote Access Policy 2026';

test('empty workspace completes md upload, review, publish, map, and ask loop', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(async () => (await page.request.get('/api/settings')).status(), {
      message: 'Vite proxy should reach the empty test API',
    })
    .toBe(200);

  await page.locator('input[type="email"]').fill('admin01@veluga.io');
  await page.locator('input[type="password"]').fill('admin01@veluga.io');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.sb-logo')).toContainText('WikiFlow');

  await page.getByRole('button', { name: /조직 지식/ }).click();
  await expect(page.locator('.kbc')).toHaveCount(0);

  await page.locator('.sb-gear').click();
  const reviewToggle = page.locator('.sb-menu-toggle input[type="checkbox"]');
  if (!(await reviewToggle.isChecked())) {
    await reviewToggle.click();
  }
  await expect(reviewToggle).toBeChecked();

  await page.getByRole('button', { name: /\+/ }).last().click();
  await page.locator('.add-fields input').first().fill(TITLE);
  await page.locator('.add-source input').fill('Security handbook section 4.2');
  await page.locator('.add-dropzone input[type="file"]').setInputFiles({
    name: 'core-pipeline-policy.md',
    mimeType: 'text/markdown',
    buffer: await readFile(path.join(process.cwd(), 'tests/fixtures/core-pipeline-policy.md')),
  });

  const [ingestResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/ingest/files') && response.ok()),
    page.locator('.add-actions button[type="submit"]').click(),
  ]);
  const ingestBody = (await ingestResponse.json()) as { items: Array<{ doc: { id: string; status: string } }> };
  const documentId = ingestBody.items[0]?.doc.id;
  expect(documentId).toBeTruthy();
  expect(ingestBody.items[0]?.doc.status).toBe('REVIEW');

  await page.getByRole('button', { name: /검토/ }).first().click();
  await expect(page.locator('.layer1-card').filter({ hasText: TITLE })).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/documents/${documentId}/approve`) && response.ok()),
    page.locator('.layer1-card').filter({ hasText: TITLE }).getByRole('button', { name: '승인' }).click(),
  ]);

  await page.getByRole('button', { name: /조직 지식/ }).click();
  await expect(page.locator('.kbc').filter({ hasText: TITLE })).toBeVisible();
  await expect(page.locator('.kbc').filter({ hasText: /VPN access requires MFA/ })).toBeVisible();

  await page.getByRole('button', { name: /지식 맵/ }).click();
  await expect(page.locator('.map-node').filter({ hasText: TITLE })).toBeVisible();

  await page.getByRole('button', { name: /지식에 질문하기/ }).click();
  await page.locator('.ask-form textarea').fill('What does the Remote Access Policy 2026 require for VPN access?');
  await page.locator('.ask-form button[type="submit"]').click();
  await expect(page.locator('.ask-answer')).toContainText('Uploaded knowledge answers this question');
  await expect(page.locator('.ask-citation').filter({ hasText: TITLE })).toBeVisible();
});
