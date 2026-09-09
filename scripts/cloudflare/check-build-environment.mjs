import { validateCloudflareBuildEnvironment } from './build-environment.mjs';

try {
  delete process.env.DEBUG;
  const { loadEnv } = await import('vite');
  validateCloudflareBuildEnvironment(loadEnv('production', process.cwd(), 'VITE_'));
  process.stdout.write('Cloudflare public build-variable contract passed\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Cloudflare build-variable validation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
