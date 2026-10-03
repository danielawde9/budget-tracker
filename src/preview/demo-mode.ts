/**
 * The local preview runs with `vite --mode demo`. Vite replaces
 * import.meta.env.MODE at build time, so demo-only code is dropped from
 * production bundles. The demo refuses any backend that is not on this
 * machine (fail closed), so the preview can never touch hosted data.
 */
export const IS_DEMO: boolean = import.meta.env.MODE === 'demo';

export function isLoopbackUrl(value: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
