import { LoansPage } from './features/loans/loans-page.js';
import { createSupabaseLoansGateway } from './features/loans/supabase-loans-gateway.js';
import type { LoansGateway } from './features/loans/types.js';
import { createBrowserDataClient } from './lib/supabase.js';

export function App({ gateway }: { gateway?: LoansGateway }) {
  const client = createBrowserDataClient();
  const activeGateway = gateway ?? (client ? createSupabaseLoansGateway(client) : null);

  if (!activeGateway) {
    return <main className="app-shell"><header className="topbar"><div><span className="brand">Budget ledger</span><h1>Loans</h1><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect this browser to the Budget development stack.</p></div><button type="button">العربية</button></header></main>;
  }

  return <LoansPage gateway={activeGateway} />;
}
