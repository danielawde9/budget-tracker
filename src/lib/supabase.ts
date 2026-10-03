import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RpcClient } from '../api/budget-api.ts';

export interface BrowserBackend {
  readonly url: string;
  readonly client: SupabaseClient;
  readonly rpc: RpcClient;
}

export function createBrowserBackend(): BrowserBackend | null {
  const url = import.meta.env['VITE_SUPABASE_URL'];
  const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];
  if (typeof url !== 'string' || typeof anonKey !== 'string' || !url || !anonKey) return null;
  const client = createClient(url, anonKey);
  const rpc: RpcClient = {
    rpc: (name, args) => client.rpc(name, args) as unknown as ReturnType<RpcClient['rpc']>,
  };
  return { url, client, rpc };
}
