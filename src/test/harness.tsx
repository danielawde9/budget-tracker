import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { BudgetApi } from '../api/budget-api.ts';
import * as s from '../api/schemas.ts';
import { WorkspaceProvider } from '../app/workspace.tsx';
import { I18nProvider } from '../lib/i18n.tsx';
import type { Locale } from '../lib/money.ts';
import accountsJson from './fixtures/accounts.json' with { type: 'json' };
import activityJson from './fixtures/activity.json' with { type: 'json' };
import billsJson from './fixtures/bills.json' with { type: 'json' };
import spacesJson from './fixtures/my-spaces.json' with { type: 'json' };
import overviewJson from './fixtures/overview.json' with { type: 'json' };
import planJson from './fixtures/plan-month.json' with { type: 'json' };

/** Real responses captured from the seeded local preview (the spec's story). */
export const fixtures = {
  spaces: s.spaceSummary.array().parse(spacesJson),
  overview: s.overview.parse(overviewJson),
  plan: s.planMonth.parse(planJson),
  accounts: s.accounts.parse(accountsJson),
  activity: s.activityPage.parse(activityJson),
  bills: s.billOccurrence.array().parse(billsJson),
};

export function space() {
  const first = fixtures.spaces[0];
  if (!first) throw new Error('fixture has no space');
  return first;
}

export type FakeApi = { [K in keyof BudgetApi]: ReturnType<typeof vi.fn> & BudgetApi[K] };

export function fakeApi(overrides: Partial<Record<keyof BudgetApi, (...args: never[]) => unknown>> = {}): FakeApi {
  const unstubbed = (name: string) => vi.fn(async () => { throw new Error(`${name} is not stubbed`); });
  const api: Record<string, unknown> = {
    mySpaces: vi.fn(async () => fixtures.spaces),
    clockToday: vi.fn(async () => space().today),
    overview: vi.fn(async () => fixtures.overview),
    planMonth: vi.fn(async () => fixtures.plan),
    accounts: vi.fn(async () => fixtures.accounts),
    activity: vi.fn(async () => fixtures.activity),
    billsUpcoming: vi.fn(async () => fixtures.bills),
    billsList: vi.fn(async () => []),
    expenseSuggestions: vi.fn(async () => ({ lastWalletId: null, suggestions: [] })),
  };
  for (const name of ['fundingPreview', 'itemStatement', 'createSpace', 'createWallet', 'updateWallet', 'assignMoney', 'recordIncome', 'recordExpense',
    'recordRefund', 'recordTransfer', 'recordExchange', 'recordInvestment', 'recordLoan', 'reverseEntry', 'saveBill', 'skipBill', 'unskipBill', 'setReferenceRate', 'savePlan']) {
    api[name] = unstubbed(name);
  }
  for (const [name, implementation] of Object.entries(overrides)) api[name] = vi.fn(implementation as (...args: unknown[]) => unknown);
  return api as unknown as FakeApi;
}

export function renderWithWorkspace(ui: ReactNode, api: FakeApi, locale: Locale = 'en'): RenderResult {
  return render(
    <I18nProvider locale={locale}>
      <WorkspaceProvider api={api as unknown as BudgetApi} space={space()} spaces={fixtures.spaces} selectSpace={vi.fn()}>
        {ui}
      </WorkspaceProvider>
    </I18nProvider>,
  );
}

export function itemId(nameEn: string): string {
  for (const group of fixtures.plan.groups) {
    for (const item of [...group.items, ...(group.flex ? [group.flex] : [])]) if (item.nameEn === nameEn) return item.itemId;
  }
  throw new Error(`fixture has no item ${nameEn}`);
}
