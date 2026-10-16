import { expect, it, vi, afterEach } from 'vitest';
import { boundedBody, createRpc } from './backend.ts';
afterEach(() => vi.unstubAllGlobals());
it('loads a supported full bilingual plan without exceeding the context response budget', async () => {
  const context = { items: Array.from({ length: 12 * 41 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    nameEn: 'Category'.padEnd(60, 'x'), nameAr: 'ف'.repeat(60), kind: 'flex',
    groupNameEn: 'Group'.padEnd(60, 'x'), groupNameAr: 'م'.repeat(60),
  })) };
  expect(new TextEncoder().encode(JSON.stringify(context)).byteLength).toBeGreaterThan(65536);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(context)));
  await expect(createRpc('https://budget.test', 'public', 'delegated')('mcp_context', {})).resolves.toEqual(context);
});
it.each(['mcp_context', 'mcp_record_entry'] as const)('keeps %s responses bounded', async name => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: 'x'.repeat(1024 * 1024) })));
  await expect(createRpc('https://budget.test', 'public', 'delegated')(name, {})).rejects.toMatchObject({ code: 'STATUS_UNKNOWN' });
});
it('uses the Workers-supported manual redirect mode and refuses upstream redirects', async () => {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.redirect === 'error') throw new TypeError('Invalid redirect value');
    return new Response(null, { status: 307, headers: { Location: 'https://unexpected.test' } });
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(createRpc('https://budget.test', 'public', '')('mcp_exchange_code', {})).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
  expect(fetcher.mock.calls[0]![1].redirect).toBe('manual');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('stops reading a chunked body at the limit even without Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(100)); c.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } });
  await expect(boundedBody(stream, 150)).rejects.toThrow('Body too large');
  expect(cancelled).toBe(true);
});
it('preserves request identity on response loss and returns no fabricated success', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => { throw new Error('response lost'); });
  vi.stubGlobal('fetch', fetcher);
  const rpc = createRpc('https://budget.test', 'public', 'delegated');
  const args = { p_request: 'same', p_amount: '2000' };
  await expect(rpc('mcp_record_entry', args)).rejects.toMatchObject({ code: 'STATUS_UNKNOWN' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ ...args, p_token: 'delegated' });
});
