import type { Page, Route } from '@playwright/test';

export interface ApplicationFixtureOptions {
  authenticated?: boolean;
  emptySpaces?: boolean;
  failFirstSignIn?: boolean;
  ambiguousSpaceOnce?: boolean;
}

const spaces = [
  { id: 'personal-space', name: 'My money', kind: 'personal', created_at: '2026-01-01T00:00:00Z' },
  { id: 'household-space', name: 'Home budget', kind: 'household', created_at: '2026-01-02T00:00:00Z' },
];

const wallets = [
  { id: 'usd-wallet', space_id: 'personal-space', name: 'Daily USD', currency: 'USD', archived_at: null },
  { id: 'lbp-wallet', space_id: 'personal-space', name: 'Home LBP', currency: 'LBP', archived_at: null },
];

const loans = [
  { id: 'maya-loan', space_id: 'personal-space', direction: 'they_owe_me', person_name: 'Maya', currency: 'USD', effective_date: '2026-07-01', due_date: '2026-09-30', note: 'Shared trip' },
  { id: 'karim-loan', space_id: 'personal-space', direction: 'i_owe_them', person_name: 'Karim', currency: 'USD', effective_date: '2026-06-01', due_date: '2026-09-01', note: null },
  { id: 'rana-loan', space_id: 'personal-space', direction: 'they_owe_me', person_name: 'Rana', currency: 'LBP', effective_date: '2026-05-01', due_date: null, note: null },
];

const balances = [
  { loan_id: 'maya-loan', space_id: 'personal-space', direction: 'they_owe_me', currency: 'USD', outstanding_minor: '75000' },
  { loan_id: 'karim-loan', space_id: 'personal-space', direction: 'i_owe_them', currency: 'USD', outstanding_minor: '120000' },
  { loan_id: 'rana-loan', space_id: 'personal-space', direction: 'they_owe_me', currency: 'LBP', outstanding_minor: '0' },
];

const events = [
  { id: 'maya-opening', space_id: 'personal-space', kind: 'loan_lend', effective_date: '2026-07-01', created_at: '2026-07-01T12:00:00Z', reversal_of: null },
  { id: 'maya-payment', space_id: 'personal-space', kind: 'loan_receive_repayment', effective_date: '2026-09-05', created_at: '2026-09-05T12:00:00Z', reversal_of: null },
  { id: 'karim-opening', space_id: 'personal-space', kind: 'loan_borrow', effective_date: '2026-06-01', created_at: '2026-06-01T12:00:00Z', reversal_of: null },
  { id: 'karim-payment', space_id: 'personal-space', kind: 'loan_repay_borrowing', effective_date: '2026-09-03', created_at: '2026-09-03T12:00:00Z', reversal_of: null },
  { id: 'rana-opening', space_id: 'personal-space', kind: 'loan_opening', effective_date: '2026-05-01', created_at: '2026-05-01T12:00:00Z', reversal_of: null },
  { id: 'rana-payment', space_id: 'personal-space', kind: 'loan_receive_repayment', effective_date: '2026-06-01', created_at: '2026-06-01T12:00:00Z', reversal_of: null },
];

const postings = [
  { event_id: 'maya-opening', loan_id: 'maya-loan', space_id: 'personal-space', principal_delta_minor: '100000', repayment_effect_minor: '0' },
  { event_id: 'maya-payment', loan_id: 'maya-loan', space_id: 'personal-space', principal_delta_minor: '-25000', repayment_effect_minor: '25000' },
  { event_id: 'karim-opening', loan_id: 'karim-loan', space_id: 'personal-space', principal_delta_minor: '200000', repayment_effect_minor: '0' },
  { event_id: 'karim-payment', loan_id: 'karim-loan', space_id: 'personal-space', principal_delta_minor: '-80000', repayment_effect_minor: '80000' },
  { event_id: 'rana-opening', loan_id: 'rana-loan', space_id: 'personal-space', principal_delta_minor: '5000000', repayment_effect_minor: '0' },
  { event_id: 'rana-payment', loan_id: 'rana-loan', space_id: 'personal-space', principal_delta_minor: '-5000000', repayment_effect_minor: '5000000' },
];

const movements = [
  { event_id: 'maya-opening', space_id: 'personal-space', wallet_id: 'usd-wallet', amount_minor: '-100000' },
  { event_id: 'maya-payment', space_id: 'personal-space', wallet_id: 'usd-wallet', amount_minor: '25000' },
  { event_id: 'karim-opening', space_id: 'personal-space', wallet_id: 'usd-wallet', amount_minor: '200000' },
  { event_id: 'karim-payment', space_id: 'personal-space', wallet_id: 'usd-wallet', amount_minor: '-80000' },
];

const plan = [
  { loan_id: 'maya-loan', currency: 'USD', direction: 'they_owe_me', target_minor: '0', actual_repayment_minor: '25000', remaining_reservation_minor: '0', due_amount_minor: '0', expected_collection_minor: '75000' },
  { loan_id: 'karim-loan', currency: 'USD', direction: 'i_owe_them', target_minor: '50000', actual_repayment_minor: '20000', remaining_reservation_minor: '30000', due_amount_minor: '120000', expected_collection_minor: '0' },
  { loan_id: 'rana-loan', currency: 'LBP', direction: 'they_owe_me', target_minor: '0', actual_repayment_minor: '0', remaining_reservation_minor: '0', due_amount_minor: '0', expected_collection_minor: '0' },
];

const summary = [
  { currency: 'USD', owed_to_me_minor: '75000', i_owe_minor: '120000', due_amount_minor: '120000', planned_repayment_minor: '50000', actual_repayment_minor: '20000', remaining_reservation_minor: '30000', expected_collection_minor: '75000' },
  { currency: 'LBP', owed_to_me_minor: '0', i_owe_minor: '0', due_amount_minor: '0', planned_repayment_minor: '0', actual_repayment_minor: '0', remaining_reservation_minor: '0', expected_collection_minor: '0' },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
}

function authUser(email: string, id = 'visual-user') {
  return {
    id, email, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
  };
}

function authSession(email = 'manager@example.test', id = 'visual-user') {
  return {
    access_token: 'visual-fixture-session', refresh_token: 'visual-fixture-refresh', token_type: 'bearer',
    expires_in: 7200, expires_at: 4_102_444_800, user: authUser(email, id),
  };
}

export async function installLoansApiFixture(page: Page, options: ApplicationFixtureOptions = {}) {
  const authenticated = options.authenticated ?? true;
  const visibleSpaces = options.emptySpaces ? [] : [...spaces];
  const visibleWallets = options.emptySpaces ? [] : [...wallets];
  let signInAttempts = 0;
  let ambiguousSpaceRemaining = options.ambiguousSpaceOnce ? 1 : 0;

  if (authenticated) {
    await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), authSession());
  } else {
    await page.addInitScript(() => localStorage.removeItem('sb-127-auth-token'));
  }

  await page.route('http://127.0.0.1:55432/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    if (url.pathname.endsWith('/token')) {
      signInAttempts += 1;
      if (options.failFirstSignIn && signInAttempts === 1) return json(route, { message: 'Invalid login credentials' }, 400);
      const body = request.postDataJSON() as { email?: string };
      return json(route, authSession(body.email ?? 'manager@example.test', body.email === 'second@example.test' ? 'visual-user-2' : 'visual-user'));
    }
    if (url.pathname.endsWith('/signup')) {
      const body = request.postDataJSON() as { email?: string };
      return json(route, { user: authUser(body.email ?? 'new@example.test', 'pending-user'), session: null });
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (url.pathname.endsWith('/user')) return json(route, authUser('manager@example.test'));
    return json(route, { message: `Unhandled auth fixture route: ${url.pathname}` }, 404);
  });

  await page.route('http://127.0.0.1:55432/rest/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    if (path.endsWith('/rpc/create_space')) {
      const body = request.postDataJSON() as { p_name: string; p_kind: 'personal' | 'household' };
      const created = { id: 'created-space', name: body.p_name, kind: body.p_kind, created_at: '2026-09-08T00:00:00Z' };
      if (!visibleSpaces.some((space) => space.id === created.id)) visibleSpaces.push(created);
      if (ambiguousSpaceRemaining > 0) {
        ambiguousSpaceRemaining -= 1;
        return json(route, { message: 'upstream timeout' }, 504);
      }
      return json(route, [{ id: created.id }]);
    }
    if (path.endsWith('/rpc/create_wallet')) {
      const body = request.postDataJSON() as { p_space_id: string; p_name: string; p_currency: 'USD' | 'LBP' };
      const created = { id: 'created-wallet', space_id: body.p_space_id, name: body.p_name, currency: body.p_currency, archived_at: null };
      if (!visibleWallets.some((wallet) => wallet.id === created.id)) visibleWallets.push(created);
      return json(route, [{ id: created.id }]);
    }
    if (path.endsWith('/rpc/reverse_financial_event')) return json(route, { message: 'the correction would invalidate dependent repayments' }, 400);
    if (path.endsWith('/rpc/loan_monthly_plan')) return json(route, plan);
    if (path.endsWith('/rpc/loan_monthly_currency_summary')) return json(route, summary);
    if (path.includes('/rpc/')) return json(route, [{ id: 'result-id', loan_id: 'new-loan', event_id: 'new-event' }]);
    if (path.endsWith('/spaces')) return json(route, visibleSpaces);
    if (path.endsWith('/wallets')) return json(route, visibleWallets);
    if (path.endsWith('/loans')) return json(route, loans);
    if (path.endsWith('/loan_balances')) return json(route, balances);
    if (path.endsWith('/financial_events')) return json(route, events);
    if (path.endsWith('/loan_postings')) return json(route, postings);
    if (path.endsWith('/wallet_movements')) return json(route, movements);
    return json(route, { message: `Unhandled visual fixture route: ${path}` }, 404);
  });
}
