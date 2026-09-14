import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planningRpc, type PlanningRpcClient, type RpcBuilder, type RpcResult } from './rpc.js';

function fakeClient(
  handler: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<RpcResult>,
): PlanningRpcClient {
  return {
    rpc(name, args) {
      let signal: AbortSignal | undefined;
      const builder: RpcBuilder = {
        abortSignal(value) {
          signal = value;
          return builder;
        },
        then(onFulfilled, onRejected) {
          if (!signal) throw new Error('abortSignal must be called before awaiting the builder.');
          return handler(name, args, signal).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

describe('planningRpc', () => {
  it('returns the data from a successful call', async () => {
    const client = fakeClient(async () => ({ data: { ok: true }, error: null }));
    await expect(planningRpc(client, 'allocation_month_state', { p_space_id: 'space-1' }))
      .resolves.toEqual({ ok: true });
  });

  it('throws the RPC error object when the result carries one', async () => {
    const client = fakeClient(async () => ({ data: null, error: { code: '42501', message: 'planning_not_authorized' } }));
    await expect(planningRpc(client, 'allocation_month_state', {}))
      .rejects.toMatchObject({ code: '42501', message: 'planning_not_authorized' });
  });

  it('passes the exact RPC name and args through to the client', async () => {
    let seen: { name: string; args: Record<string, unknown> } | null = null;
    const client = fakeClient(async (name, args) => {
      seen = { name, args };
      return { data: null, error: null };
    });
    await planningRpc(client, 'allocation_category_page', { p_space_id: 'space-1', p_limit: 50 });
    expect(seen).toEqual({ name: 'allocation_category_page', args: { p_space_id: 'space-1', p_limit: 50 } });
  });

  it('aborts the underlying call when the caller signal fires', async () => {
    const controller = new AbortController();
    const client = fakeClient((_name, _args, signal) => new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error('aborted'));
      else signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = planningRpc(client, 'allocation_trend', {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('cancels immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let observedAborted = false;
    const client = fakeClient(async (_name, _args, signal) => {
      observedAborted = signal.aborted;
      return { data: null, error: null };
    });
    await planningRpc(client, 'allocation_trend', {}, controller.signal);
    expect(observedAborted).toBe(true);
  });

  it('does not leak the abort listener onto a long-lived caller signal after completion', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const client = fakeClient(async () => ({ data: 'ok', error: null }));
    await planningRpc(client, 'allocation_trend', {}, controller.signal);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('planningRpc timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('aborts after 15 seconds when neither the response nor the caller settles first', async () => {
    const client = fakeClient((_name, _args, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('timed out')));
    }));
    const pending = planningRpc(client, 'allocation_month_state', {});
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('does not fire the timeout once the call already settled', async () => {
    const client = fakeClient(async () => ({ data: 'ready', error: null }));
    const result = await planningRpc(client, 'allocation_month_state', {});
    expect(result).toBe('ready');
    // If the timer were still armed, advancing past it would throw asynchronously
    // and vitest would report an unhandled rejection for this test.
    await vi.advanceTimersByTimeAsync(15_000);
  });
});
