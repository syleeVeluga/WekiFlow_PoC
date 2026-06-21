import { expect, test } from '@playwright/test';

test('renders the unauthenticated web app shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.login-brand')).toContainText('WikiFlow');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('keeps cleared home empty, then shows a directly uploaded markdown item', async ({ page }) => {
  await page.request.post('/api/__test/reset');
  await page.request.post('/api/documents', {
    data: { title: 'Raw Draft Intake', contentMarkdown: '# Raw Draft Intake' },
  });
  await page.goto('/');
  await page.locator('input[type="email"]').fill('admin01@veluga.io');
  await page.locator('input[type="password"]').fill('admin01@veluga.io');
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page.getByRole('heading', { name: '오늘, 조직이 새로 배운 것' })).toBeVisible();
  await expect(page.getByText('아직 새로 정리된 지식이 없습니다.')).toBeVisible();
  await expect(page.getByText('표시할 주제가 없습니다.')).toBeVisible();
  await expect(page.getByText('법인카드 정산')).toHaveCount(0);
  await expect(page.getByText('건강검진 안내')).toHaveCount(0);
  await expect(page.getByText('인입 원본')).toBeVisible();
  await expect(page.getByRole('button', { name: '▫ Raw Draft Intake 지식화 안 됨' })).toBeVisible();
  await page.getByRole('button', { name: /Raw Draft Intake/ }).click();
  await expect(page.getByRole('button', { name: 'AI로 지식화' })).toBeVisible();
  await page.getByRole('button', { name: 'AI로 지식화' }).click();
  await expect(page.getByText('지식화 완료')).toBeVisible();
  await expect
    .poll(async () => JSON.stringify(await (await page.request.get('/api/tree/categories')).json()))
    .toContain('Raw Draft Intake');

  await page.getByRole('button', { name: '직접 추가' }).click();
  await page.getByPlaceholder('예: 법인카드 사용 기준').fill('Home Digest Upload');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'home-digest-upload.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Home Digest Upload\n\nUploaded from the end-to-end direct add flow.'),
  });
  await expect(page.getByText('home-digest-upload.md')).toBeVisible();
  await page.getByRole('button', { name: '검토 요청하기' }).click();
  await expect(page.getByText('검토 요청을 접수했습니다.')).toBeVisible();

  await page.getByRole('button', { name: '홈' }).click();
  await expect(page.getByRole('button', { name: 'Home Digest Upload', exact: true })).toBeVisible();
  await expect(page.getByText('법인카드 정산')).toHaveCount(0);
});
