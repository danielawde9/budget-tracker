import { createClient } from '@supabase/supabase-js';
import type { SupabaseAuthClient } from '../features/auth/supabase-auth-gateway.js';
import type { LoansDataClient } from '../features/loans/supabase-loans-gateway.js';
import type { WalletsDataClient } from '../features/wallets/supabase-wallets-gateway.js';

const url = import.meta.env['VITE_SUPABASE_URL'];
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];

export type BudgetDataClient = LoansDataClient & SupabaseAuthClient & WalletsDataClient;

export function createBrowserDataClient(): BudgetDataClient | null {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey) as unknown as BudgetDataClient;
}
