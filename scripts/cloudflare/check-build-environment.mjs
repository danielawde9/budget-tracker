import { validateCloudflareBuildEnvironment } from './build-environment.mjs';

try {
  validateCloudflareBuildEnvironment(process.env);
  process.stdout.write('Cloudflare public build-variable contract passed\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Cloudflare build-variable validation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
