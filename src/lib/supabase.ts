import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createBrowserClient(): SupabaseClient | null {
  const url = import.meta.env['VITE_SUPABASE_URL'];
  const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}
