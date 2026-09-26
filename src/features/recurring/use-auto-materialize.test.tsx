import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRecurringGateway } from '../../test/in-memory-recurring-gateway.js';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { useAutoMaterialize } from './use-auto-materialize.js';

describe('useAutoMaterialize', () => {
  it('generates the shared window once when needed, then reloads', async () => {
    const gateway = new InMemoryRecurringGateway();
    const onGenerated = vi.fn(async () => undefined);
    const { rerender } = renderHook((props: { needed: boolean }) => useAutoMaterialize({
      gateway, spaceId: 'space-1', today: '2026-09-25', needed: props.needed, onGenerated,
    }), { initialProps: { needed: true } });
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
    rerender({ needed: true });
    const generated = gateway.calls.filter((call) => call.name === 'materialize');
    expect(generated).toHaveLength(1);
    expect(generated[0]!.input).toMatchObject({ spaceId: 'space-1', fromDate: '2026-09-25', toDate: '2026-12-23' });
  });

  it('does nothing when not needed', () => {
    const gateway = new InMemoryRecurringGateway();
    renderHook(() => useAutoMaterialize({ gateway, spaceId: 'space-1', today: '2026-09-25', needed: false, onGenerated: vi.fn() }));
    expect(gateway.calls).toHaveLength(0);
  });

  it('reports a classified failure without retrying in a loop', async () => {
    const gateway = new InMemoryRecurringGateway();
    // The plain `{ code, message }` object the real gateway rethrows, never
    // `new Error(...)` -- final review I1.
    vi.spyOn(gateway, 'materialize').mockRejectedValue(
      postgrestRejection('P0001', 'materializing this range would create more than 500 new occurrences'),
    );
    const { result } = renderHook(() => useAutoMaterialize({ gateway, spaceId: 'space-1', today: '2026-09-25', needed: true, onGenerated: vi.fn() }));
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', error: expect.objectContaining({ code: 'materialize_cap_exceeded' }) }));
    expect(gateway.materialize).toHaveBeenCalledTimes(1);
  });
});
