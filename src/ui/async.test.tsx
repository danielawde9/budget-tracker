import { act, renderHook, waitFor } from '@testing-library/react';
import { useLoad } from './async.tsx';

describe('useLoad', () => {
  it('returns the same object until its state changes', async () => {
    const load = vi.fn(async () => 'value');
    const { result, rerender } = renderHook(({ tick }: { tick: number }) => ({ tick, loaded: useLoad(load, []) }), { initialProps: { tick: 0 } });
    await waitFor(() => expect(result.current.loaded.status).toBe('ready'));
    const before = result.current.loaded;
    act(() => rerender({ tick: 1 }));
    // Screens key effects on this object; a fresh one each render re-runs them forever.
    expect(result.current.loaded).toBe(before);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
