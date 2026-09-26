import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Only *.spec.ts files are Playwright tests. The default pattern also picks
  // up *.test.ts, and one stray Vitest file under e2e/ once made the whole
  // collection "0 tests in 0 files" (Task 8; final review recommendation 4).
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'light',
    locale: 'en-US',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm vite --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:55432',
      VITE_SUPABASE_ANON_KEY: 'visual-test-anon-key',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome', viewport: { width: 390, height: 844 } } },
  ],
});
