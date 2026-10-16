import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': new URL('./worker/mcp/test-cloudflare.ts', import.meta.url).pathname } },
  test: { environment: 'node', include: ['worker/mcp/**/*.test.ts'], server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } } },
});
