import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
const HOST = process.env.PLAYWRIGHT_HOST ?? '127.0.0.1';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${HOST}:${PORT}`;
const API_PORT = Number(process.env.PLAYWRIGHT_API_PORT ?? 4100);
const apiURL = process.env.PLAYWRIGHT_API_URL ?? `http://${HOST}:${API_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node tests/e2e/support/start-empty-api.mjs ${HOST} ${API_PORT}`,
      url: `${apiURL}/api/settings`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `node tests/e2e/support/start-web.mjs ${HOST} ${PORT} ${apiURL}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
