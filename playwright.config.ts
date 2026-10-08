import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive real Chrome against the LOCAL preview stack
// (pnpm preview:up). Each test creates its own throwaway user.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    colorScheme: 'light',
    locale: 'en-US',
    channel: 'chrome',
    trace: 'retain-on-failure',
    timezoneId: 'Asia/Beirut',
  },
  webServer: {
    command: 'pnpm demo',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' } },
    { name: 'mobile-small', testMatch: '**/mobile.spec.ts', use: { ...devices['iPhone SE'], defaultBrowserType: 'chromium', channel: 'chrome', viewport: { width: 320, height: 568 } } },
  ],
});
