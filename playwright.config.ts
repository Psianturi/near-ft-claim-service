import { defineConfig, devices } from '@playwright/test';

const host = process.env.PLAYWRIGHT_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '4173', 10);

export default defineConfig({
  testDir: './tests/frontend',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://${host}:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npx http-server examples/send-ft-frontend -a ${host} -p ${port} -c-1`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
