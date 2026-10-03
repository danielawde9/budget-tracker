import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BudgetError } from '../api/budget-api.ts';
import type { BillOccurrence } from '../api/schemas.ts';
import { translate, type I18n } from '../lib/i18n.tsx';
import { formatMoney } from '../lib/money.ts';
import { InvestForm } from '../record/forms-accounts.tsx';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { errorText } from '../ui/async.tsx';
import { ActivityScreen } from './activity/activity.tsx';
import { BillsSection } from './plan/bills-section.tsx';
import { PlanScreen } from './plan/plan.tsx';

const i18n: I18n = {
  locale: 'en', dir: 'ltr', t: (key, vars) => translate('en', key, vars),
  money: (minor, currency) => formatMoney(minor, currency, 'en'), date: (value) => value,
  name: (value) => value.nameEn ?? value.nameAr ?? '', digits: (value) => value,
};

describe('error messages exist for every refusal the forms can meet', () => {
  it.each(['BUDGET_WALLET_BOUNDS', 'BUDGET_BILL_NOT_SKIPPED'])('%s has its own message', (code) => {
    expect(errorText(i18n, new BudgetError(code))).not.toBe(translate('en', 'error.UNKNOWN'));
  });
});

describe('a lost reply is not reported as nothing saved', () => {
  it('tells the person to retry from the same form instead', () => {
    const text = errorText(i18n, new BudgetError('NETWORK'));
    expect(text).not.toMatch(/Nothing was saved/);
    expect(text).toMatch(/same form/);
  });
});

describe('Activity “Show more” reports a failure', () => {
  it('shows the error instead of swallowing it', async () => {
    const api = fakeApi({
      activity: async (_space: string, options: { before?: unknown }) => {
        if (options.before) throw new BudgetError('NETWORK');
        return { ...fixtures.activity, next: { occurredOn: '2026-10-01', createdAt: '2026-10-01T09:00:00+03:00', id: 'x' } };
      },
    });
    const user = userEvent.setup();
    renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, api);
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText(/The server could not be reached/)).toBeInTheDocument();
  });
});

describe('Activity “Show more” keeps what it loaded', () => {
  it('appends the next page and keeps it on screen', async () => {
    const [firstEntry, ...rest] = fixtures.activity.entries;
    if (!firstEntry) throw new Error('fixture has no entries');
    const older = { ...firstEntry, entryId: 'older-entry', memo: 'Older bakery visit' };
    const api = fakeApi({
      activity: async (_space: string, options: { before?: unknown }) =>
        options.before ? { entries: [older], next: null } : { entries: [firstEntry, ...rest], next: fixtures.activity.next },
    });
    const user = userEvent.setup();
    renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, api);
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText(/Older bakery visit/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText(/Older bakery visit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });
});

describe('the investment form picks its item without reading group names', () => {
  it('defaults to the last group’s flexible item even when the group is renamed', () => {
    const groups = fixtures.plan.groups.map((group, index, all) => (index === all.length - 1 ? { ...group, nameEn: 'Long term', nameAr: 'المدى الطويل' } : group));
    const catalog = { plan: { ...fixtures.plan, groups }, accounts: fixtures.accounts, ready: { USD: 132000n, LBP: 0n } };
    renderWithWorkspace(<InvestForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi());
    expect(screen.getByRole('combobox', { name: 'Money set aside in' })).toHaveDisplayValue(/^To invest/);
  });
});

describe('a past month shows Ready to assign at that month’s end', () => {
  it('labels and uses the month-end balance', async () => {
    const past = { ...fixtures.plan, month: '2026-09-01', isPast: true, isCurrent: false, ready: 132000n, readyAtMonthEnd: 122000n };
    renderWithWorkspace(<PlanScreen month="2026-09-01" onRecord={vi.fn()} />, fakeApi({ planMonth: async () => past }));
    const summary = await screen.findByRole('region', { name: 'That month' });
    const figure = within(summary).getByText('Ready to assign at month end').closest('div');
    expect(figure).toHaveTextContent('$1,220.00');
  });
});

describe('bills can be skipped and un-skipped', () => {
  const internet = fixtures.bills.find((occurrence) => occurrence.name === 'Internet');
  const bill = { billId: internet?.billId ?? '', name: 'Internet', itemId: internet?.itemId ?? '', amount: 4500n, currency: 'USD' as const, cadence: 'monthly' as const, firstDueOn: '2026-09-20', endOn: null, loanWalletId: null };

  it('skips the next occurrence', async () => {
    const api = fakeApi({ billsList: async () => [bill], skipBill: async () => ({ billId: bill.billId }) });
    const user = userEvent.setup();
    renderWithWorkspace(<BillsSection onRecord={vi.fn()} />, api);
    const row = (await screen.findByText('Internet')).closest('li');
    if (!row) throw new Error('no row');
    await user.click(within(row).getByRole('button', { name: 'Skip' }));
    expect(api.skipBill).toHaveBeenCalledWith(expect.objectContaining({ billId: bill.billId, due: '2026-10-20' }));
  });

  it('undoes a skip', async () => {
    const skipped: BillOccurrence[] = fixtures.bills.map((occurrence) => (occurrence.name === 'Internet' ? { ...occurrence, status: 'skipped', coverage: null } : occurrence));
    const api = fakeApi({ billsList: async () => [bill], billsUpcoming: async () => skipped, unskipBill: async () => ({ billId: bill.billId }) });
    const user = userEvent.setup();
    renderWithWorkspace(<BillsSection onRecord={vi.fn()} />, api);
    const row = (await screen.findByText('Internet')).closest('li');
    if (!row) throw new Error('no row');
    await user.click(within(row).getByRole('button', { name: 'Undo skip' }));
    expect(api.unskipBill).toHaveBeenCalledWith(expect.objectContaining({ billId: bill.billId, due: '2026-10-20' }));
  });
});
