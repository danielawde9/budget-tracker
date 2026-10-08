import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';

// Isolate these real local-database checks from a demo open in the main checkout.
const baseURL = 'http://127.0.0.1:5174';
export default defineConfig({
  ...base,
  testMatch: 'bill-payments.spec.ts',
  use: { ...base.use, baseURL },
  webServer: {
    command: 'pnpm exec vite --mode demo --host 127.0.0.1 --port 5174',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' } },
    { name: 'small', use: { ...devices['iPhone SE'], viewport: { width: 320, height: 568 }, defaultBrowserType: 'chromium', channel: 'chrome' } },
  ],
});
