import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:3000/manus-routes.json',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_PROVIDER: 'postgres',
      DATABASE_URL: '',
      NODE_ENV: 'development',
      PUBLIC_HTTPS: 'false',
    },
  },
});
