export interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message: string } | null;
}
export interface RpcBuilder extends PromiseLike<RpcResult> {
  abortSignal(signal: AbortSignal): RpcBuilder;
}
export interface PlanningRpcClient {
  rpc(name: string, args: Record<string, unknown>): RpcBuilder;
}

const RPC_TIMEOUT_MS = 15_000;

export async function planningRpc(
  client: PlanningRpcClient,
  name: string,
  args: Record<string, unknown>,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (callerSignal?.aborted) cancel();
  callerSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, RPC_TIMEOUT_MS);
  try {
    const result = await client.rpc(name, args).abortSignal(controller.signal);
    if (result.error) throw result.error;
    return result.data;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', cancel);
  }
}
