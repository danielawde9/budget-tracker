import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
    globalSetup: ['tests/db/support/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    environment: 'node',
  },
});
