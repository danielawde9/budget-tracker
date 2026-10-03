import { isLoopbackUrl } from './demo-mode.ts';

describe('the preview refuses non-local backends', () => {
  it.each([
    ['http://127.0.0.1:54421', true],
    ['http://localhost:54421', true],
    ['https://dfuxxzlhmxscgvxdmwti.supabase.co', false],
    ['http://100.76.160.91:54421', false],
    ['not a url', false],
  ])('%s → %s', (url, local) => {
    expect(isLoopbackUrl(url)).toBe(local);
  });
});
