import { createClient } from '@supabase/supabase-js';
import type { SupabaseAuthClient } from '../features/auth/supabase-auth-gateway.js';
import type { CategoriesDataClient } from '../features/categories/supabase-categories-gateway.js';
import type { LoansDataClient } from '../features/loans/supabase-loans-gateway.js';
import type { WalletsDataClient } from '../features/wallets/supabase-wallets-gateway.js';
import type { HouseholdDataClient } from '../features/household/supabase-household-gateway.js';
import type { AllocationDataClient } from '../features/allocation/supabase-allocation-gateway.js';
import type { GoalsDataClient } from '../features/goals/supabase-goals-gateway.js';
import type { RecurringDataClient } from '../features/recurring/supabase-recurring-gateway.js';
import type { CashControlDataClient } from '../features/cash-control/supabase-cash-control-gateway.js';

export type BudgetDataClient = LoansDataClient & SupabaseAuthClient & WalletsDataClient & CategoriesDataClient & HouseholdDataClient & AllocationDataClient & GoalsDataClient & RecurringDataClient & CashControlDataClient;

export function createBrowserDataClient(): BudgetDataClient | null {
  const url = import.meta.env['VITE_SUPABASE_URL'];
  const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];
  if (!url || !anonKey) return null;
  return createClient(url, anonKey) as unknown as BudgetDataClient;
}

/**
 * Reads the current session bearer token for same-origin API boundaries
 * (household invitation delivery). Returns null when no usable token exists;
 * the token is only ever sent as an Authorization header, never logged.
 */
export async function readBrowserAccessToken(client: BudgetDataClient): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) return null;
  const token = (data.session as unknown as Record<string, unknown>)['access_token'];
  return typeof token === 'string' && token.length > 0 ? token : null;
}
