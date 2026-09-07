import { createClient } from '@supabase/supabase-js';
import type { LoansDataClient } from '../features/loans/supabase-loans-gateway.js';

const url = import.meta.env['VITE_SUPABASE_URL'];
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];

export function createBrowserDataClient(): LoansDataClient | null {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey) as unknown as LoansDataClient;
}
