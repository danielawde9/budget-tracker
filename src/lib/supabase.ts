import { createClient } from '@supabase/supabase-js';
import type { SupabaseAuthClient } from '../features/auth/supabase-auth-gateway.js';
import type { CategoriesDataClient } from '../features/categories/supabase-categories-gateway.js';
import type { LoansDataClient } from '../features/loans/supabase-loans-gateway.js';
import type { WalletsDataClient } from '../features/wallets/supabase-wallets-gateway.js';
import type { HouseholdDataClient } from '../features/household/supabase-household-gateway.js';
import type { AllocationDataClient } from '../features/allocation/supabase-allocation-gateway.js';
import type { GoalsDataClient } from '../features/goals/supabase-goals-gateway.js';

export type BudgetDataClient = LoansDataClient & SupabaseAuthClient & WalletsDataClient & CategoriesDataClient & HouseholdDataClient & AllocationDataClient & GoalsDataClient;

export function createBrowserDataClient(): BudgetDataClient | null {
  const url = import.meta.env['VITE_SUPABASE_URL'];
  const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];
  if (!url || !anonKey) return null;
  return createClient(url, anonKey) as unknown as BudgetDataClient;
}
