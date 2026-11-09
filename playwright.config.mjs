import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './integration-tests',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: 'http://127.0.0.1:8791/api/health',
    reuseExistingServer: false,
    timeout: 15000
  },
  use: {
    baseURL: 'http://127.0.0.1:8791',
    channel: 'msedge',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
