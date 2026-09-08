import type { Page, Route } from '@playwright/test';

export interface ApplicationFixtureOptions {
  authenticated?: boolean;
  emptySpaces?: boolean;
  failFirstSignIn?: boolean;
  ambiguousSpaceOnce?: boolean;
  emptyWallets?: boolean;
  ambiguousEventOnce?: boolean;
}

interface VisualEvent {
  id: string;
  space_id: string;
  request_id: string;
  kind: string;
  effective_date: string;
  created_at: string;
  reversal_of: string | null;
}

const spaces = [
  { id: 'personal-space', name: 'My money', kind: 'personal', created_at: '2026-01-01T00:00:00Z' },
  { id: 'household-space', name: 'Home budget', kind: 'household', created_at: '2026-01-02T00:00:00Z' },
];

const wallets = [
  { id: 'usd-wallet', space_id: 'personal-space', name: 'Daily USD', currency: 'USD', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'reserve-usd-wallet', space_id: 'personal-space', name: 'Reserve USD', currency: 'USD', archived_at: null, created_at: '2026-01-02T00:00:00Z' },
  { id: 'lbp-wallet', space_id: 'personal-space', name: 'Home LBP', currency: 'LBP', archived_at: null, created_at: '2026-01-03T00:00:00Z' },
  { id: 'household-usd-wallet', space_id: 'household-space', name: 'Household USD', currency: 'USD', archived_at: null, created_at: '2026-01-04T00:00:00Z' },
];

const walletBalances = [
  { wallet_id: 'usd-wallet', space_id: 'personal-space', currency: 'USD', amount_minor: '125050' },
  { wallet_id: 'reserve-usd-wallet', space_id: 'personal-space', currency: 'USD', amount_minor: '50000' },
  { wallet_id: 'lbp-wallet', space_id: 'personal-space', currency: 'LBP', amount_minor: '2500000' },
  { wallet_id: 'household-usd-wallet', space_id: 'household-space', currency: 'USD', amount_minor: '30000' },
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

const events: VisualEvent[] = [
  { id: 'general-income', space_id: 'personal-space', request_id: 'request-general-income', kind: 'income', effective_date: '2026-09-07', created_at: '2026-09-07T14:00:00Z', reversal_of: null },
  { id: 'maya-opening', space_id: 'personal-space', request_id: 'request-maya-opening', kind: 'loan_lend', effective_date: '2026-07-01', created_at: '2026-07-01T12:00:00Z', reversal_of: null },
  { id: 'maya-payment', space_id: 'personal-space', request_id: 'request-maya-payment', kind: 'loan_receive_repayment', effective_date: '2026-09-05', created_at: '2026-09-05T12:00:00Z', reversal_of: null },
  { id: 'karim-opening', space_id: 'personal-space', request_id: 'request-karim-opening', kind: 'loan_borrow', effective_date: '2026-06-01', created_at: '2026-06-01T12:00:00Z', reversal_of: null },
  { id: 'karim-payment', space_id: 'personal-space', request_id: 'request-karim-payment', kind: 'loan_repay_borrowing', effective_date: '2026-09-03', created_at: '2026-09-03T12:00:00Z', reversal_of: null },
  { id: 'rana-opening', space_id: 'personal-space', request_id: 'request-rana-opening', kind: 'loan_opening', effective_date: '2026-05-01', created_at: '2026-05-01T12:00:00Z', reversal_of: null },
  { id: 'rana-payment', space_id: 'personal-space', request_id: 'request-rana-payment', kind: 'loan_receive_repayment', effective_date: '2026-06-01', created_at: '2026-06-01T12:00:00Z', reversal_of: null },
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
  { event_id: 'general-income', space_id: 'personal-space', wallet_id: 'usd-wallet', amount_minor: '25050' },
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
  const visibleWallets = options.emptySpaces || options.emptyWallets ? [] : [...wallets];
  const visibleWalletBalances = options.emptySpaces || options.emptyWallets ? [] : [...walletBalances];
  const visibleEvents = options.emptyWallets ? [] : [...events];
  const visibleMovements = options.emptyWallets ? [] : [...movements];
  const visiblePostings = options.emptyWallets ? [] : [...postings];
  let signInAttempts = 0;
  let ambiguousSpaceRemaining = options.ambiguousSpaceOnce ? 1 : 0;
  let ambiguousEventRemaining = options.ambiguousEventOnce ? 1 : 0;
  let eventSequence = 0;

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
    const url = new URL(request.url());
    const path = url.pathname;
    const equalValue = (name: string) => {
      const value = url.searchParams.get(name);
      return value?.startsWith('eq.') ? value.slice(3) : null;
    };
    const includedValues = (name: string) => {
      const value = url.searchParams.get(name);
      if (!value?.startsWith('in.(') || !value.endsWith(')')) return null;
      return new Set(value.slice(4, -1).split(','));
    };
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
      const created = { id: `created-wallet-${visibleWallets.length + 1}`, space_id: body.p_space_id, name: body.p_name, currency: body.p_currency, archived_at: null, created_at: '2026-09-08T00:00:00Z' };
      if (!visibleWallets.some((wallet) => wallet.id === created.id)) visibleWallets.push(created);
      visibleWalletBalances.push({ wallet_id: created.id, space_id: body.p_space_id, currency: body.p_currency, amount_minor: '0' });
      return json(route, [{ id: created.id }]);
    }
    if (path.endsWith('/rpc/record_financial_event')) {
      const body = request.postDataJSON() as { p_space_id: string; p_request_id: string; p_kind: string; p_effective_date: string; p_movements: Array<{ walletId: string; amountMinor: string }> };
      eventSequence += 1;
      const id = `general-event-${eventSequence}`;
      visibleEvents.unshift({ id, space_id: body.p_space_id, request_id: body.p_request_id, kind: body.p_kind, effective_date: body.p_effective_date, created_at: `2026-09-08T12:${String(eventSequence).padStart(2, '0')}:00Z`, reversal_of: null });
      for (const movement of body.p_movements) {
        visibleMovements.push({ event_id: id, space_id: body.p_space_id, wallet_id: movement.walletId, amount_minor: movement.amountMinor });
        const balance = visibleWalletBalances.find((item) => item.wallet_id === movement.walletId && item.space_id === body.p_space_id);
        if (balance) balance.amount_minor = (BigInt(balance.amount_minor) + BigInt(movement.amountMinor)).toString();
      }
      if (ambiguousEventRemaining > 0) {
        ambiguousEventRemaining -= 1;
        return json(route, { message: 'upstream timeout' }, 504);
      }
      return json(route, [{ id }]);
    }
    if (path.endsWith('/rpc/reverse_financial_event')) {
      const body = request.postDataJSON() as { p_space_id: string; p_request_id: string; p_event_id: string; p_effective_date: string };
      if (visiblePostings.some((posting) => posting.event_id === body.p_event_id)) {
        return json(route, { message: 'the correction would invalidate dependent repayments' }, 400);
      }
      const original = visibleEvents.find((event) => event.id === body.p_event_id && event.space_id === body.p_space_id);
      if (!original || visibleEvents.some((event) => event.reversal_of === original.id)) {
        return json(route, { message: 'the requested event already has a reversal' }, 400);
      }
      eventSequence += 1;
      const id = `reversal-event-${eventSequence}`;
      visibleEvents.unshift({ id, space_id: body.p_space_id, request_id: body.p_request_id, kind: 'reversal', effective_date: body.p_effective_date, created_at: `2026-09-08T13:${String(eventSequence).padStart(2, '0')}:00Z`, reversal_of: original.id });
      for (const movement of visibleMovements.filter((item) => item.event_id === original.id)) {
        const amountMinor = (-BigInt(movement.amount_minor)).toString();
        visibleMovements.push({ event_id: id, space_id: body.p_space_id, wallet_id: movement.wallet_id, amount_minor: amountMinor });
        const balance = visibleWalletBalances.find((item) => item.wallet_id === movement.wallet_id && item.space_id === body.p_space_id);
        if (balance) balance.amount_minor = (BigInt(balance.amount_minor) + BigInt(amountMinor)).toString();
      }
      return json(route, [{ id }]);
    }
    if (path.endsWith('/rpc/loan_monthly_plan')) return json(route, plan);
    if (path.endsWith('/rpc/loan_monthly_currency_summary')) return json(route, summary);
    if (path.includes('/rpc/')) return json(route, [{ id: 'result-id', loan_id: 'new-loan', event_id: 'new-event' }]);
    if (path.endsWith('/spaces')) return json(route, visibleSpaces);
    if (path.endsWith('/wallets')) {
      const spaceId = equalValue('space_id');
      return json(route, visibleWallets.filter((wallet) => !spaceId || wallet.space_id === spaceId));
    }
    if (path.endsWith('/wallet_balances')) {
      const spaceId = equalValue('space_id');
      return json(route, visibleWalletBalances.filter((balance) => !spaceId || balance.space_id === spaceId));
    }
    if (path.endsWith('/loans')) {
      const spaceId = equalValue('space_id');
      return json(route, loans.filter((loan) => !spaceId || loan.space_id === spaceId));
    }
    if (path.endsWith('/loan_balances')) {
      const spaceId = equalValue('space_id');
      return json(route, balances.filter((balance) => !spaceId || balance.space_id === spaceId));
    }
    if (path.endsWith('/financial_events')) {
      const spaceId = equalValue('space_id');
      const requestId = equalValue('request_id');
      const reversalIds = includedValues('reversal_of');
      return json(route, visibleEvents.filter((event) =>
        (!spaceId || event.space_id === spaceId)
        && (!requestId || event.request_id === requestId)
        && (!reversalIds || (event.reversal_of !== null && reversalIds.has(event.reversal_of))),
      ));
    }
    if (path.endsWith('/loan_postings')) {
      const spaceId = equalValue('space_id');
      const eventIds = includedValues('event_id');
      return json(route, visiblePostings.filter((posting) => (!spaceId || posting.space_id === spaceId) && (!eventIds || eventIds.has(posting.event_id))));
    }
    if (path.endsWith('/wallet_movements')) {
      const spaceId = equalValue('space_id');
      const eventIds = includedValues('event_id');
      return json(route, visibleMovements.filter((movement) => (!spaceId || movement.space_id === spaceId) && (!eventIds || eventIds.has(movement.event_id))));
    }
    return json(route, { message: `Unhandled visual fixture route: ${path}` }, 404);
  });
}
