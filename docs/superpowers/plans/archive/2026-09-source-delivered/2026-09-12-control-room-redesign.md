# Control Room Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app's UI as the light-first, phone-first "Control Room" described in `docs/superpowers/specs/2026-09-12-control-room-redesign-design.md`, on top of the unchanged SQL/Supabase backend.

**Architecture:** Five destinations (Home · Journal · +Record · Plan · Manage). Existing gateways and hooks (`useWallets`, `useLoans`, `useCategories`, `useAuthSession`, `useWorkspace`) are reused unchanged. New data clients are added for SQL functions that have no frontend caller yet. New UI lives in new folders; old screens are deleted in the final cleanup task.

**Tech Stack:** React 19 + TypeScript + Vite, plain CSS (no framework), `@supabase/supabase-js`, `lucide-react`, Vitest + Testing Library, Playwright. Package manager: **pnpm** (`pnpm@11.17.0`).

---

## Hard constraints (read first)

1. **UAT scope freeze.** `scripts/check-private-uat-scope.sh` fails if any of these change since the pinned SHA: `supabase/`, `tests/db/`, `src/features/auth/`, any file matching `src/features/**/supabase-*-gateway.ts`, `src/features/household*/`, `src/features/monthly-budget*/`, `src/features/monthly_budget/`, `src/features/budget/`, `src/features/reporting/`, `src/features/reports/`. Therefore:
   - New data clients MUST NOT be named `supabase-*-gateway.ts` and MUST NOT live in those folders. This plan uses `src/features/plan/`, `src/features/insights/`, `src/features/exchange/` with files named `*-client.ts`.
   - Never edit an existing `supabase-*-gateway.ts`. Reuse them via their TypeScript interfaces.
   - Verify after every task: `pnpm check:uat:scope`.
2. **Money is always minor units as `string`** (bigint-safe). Format with `formatMinorAmount(amountMinor, currency, locale)` from `src/features/wallets/money.ts`.
3. **Months are normalized strings** matching `/^\d{4}-\d{2}-01$/`. Dates are ISO `YYYY-MM-DD`.
4. **i18n:** `Locale = 'en' | 'ar'` (from `src/features/loans/types.ts`). Per-component copy via the established helper:
   ```ts
   const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);
   ```
   RTL is handled globally: `document.documentElement.dir` is already set in `app.tsx`. New CSS MUST use logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`). Never physical `left/right/margin-left` etc.
5. **No new runtime dependencies.** Charts are hand-rolled divs.
6. **Test commands:** `pnpm test:ui` (jsdom unit/component), `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` (Playwright, needs Chrome). `pnpm test:db` must keep passing untouched (needs Docker).
7. Existing in-memory test doubles live in `src/test/` (`InMemoryWalletsGateway`, `InMemoryLoansGateway`, `InMemoryCategoriesGateway`, `InMemoryHouseholdGateway`). Tests never touch real Supabase; `src/app.test.tsx` shows the fake-gateway pattern.

## File structure (new unless noted)

```
src/control-room.css                          — theme tokens + all new component classes (imported in main.tsx after styles.css)
src/features/plan/types.ts                    — PlanClient interface + budget types
src/features/plan/plan-client.ts              — createPlanClient(client): PlanClient  (RPC: set_monthly_income_plan, set_monthly_category_target, monthly_budget_currency_summary, monthly_budget_category_page)
src/features/plan/use-plan.ts                 — usePlan hook with idempotent request-id retry
src/features/plan/plan-page.tsx               — Plan screen
src/features/insights/types.ts                — InsightsClient interface
src/features/insights/insights-client.ts      — createInsightsClient(client)  (RPC: report_wallet_activity, report_category_actual_vs_budget)
src/features/exchange/types.ts                — ExchangeClient interface
src/features/exchange/exchange-client.ts      — createExchangeClient(client)  (RPC: record_usd_to_lbp_exchange)
src/features/exchange/use-exchange.ts         — useExchange hook (ambiguous-retry via walletsGateway.findEventByRequestId)
src/features/control-room/types.ts            — ControlRoomDestination, shared props
src/features/control-room/control-room-shell.tsx  — shell: bottom tab bar (mobile) / left rail (desktop), record FAB
src/features/control-room/routes.tsx          — destination switch + record sheet mounting
src/features/control-room/home-screen.tsx     — dashboard
src/features/control-room/journal-screen.tsx  — immutable ledger feed + entry detail
src/features/control-room/record-sheet.tsx    — stepped write surface (the core flow)
src/features/control-room/manage-screen.tsx   — wallets/categories/loans/household/settings sections
src/test/in-memory-plan-client.ts             — test double
src/test/in-memory-insights-client.ts         — test double
src/test/in-memory-exchange-client.ts         — test double
Modify: src/app.tsx            — swap ApplicationShell/WorkspaceRoutes → ControlRoomShell/routes
Modify: src/main.tsx           — import ./control-room.css after ./styles.css
Modify: src/app.test.tsx       — update nav expectations (new destination labels)
Modify: e2e/workspace-navigation.ts — new tab-bar navigation helpers
Modify: e2e/fixtures/...       — add RPC mocks for plan/insights/exchange functions
Create: e2e/control-room.visual.spec.ts
Delete (Task 14): src/features/home/, src/features/shell/application-shell.tsx, workspace-navigation.tsx, workspace-routes leftovers
```

---

## Task 1: Plan data client

**Files:**
- Create: `src/features/plan/types.ts`
- Create: `src/features/plan/plan-client.ts`
- Test: `src/features/plan/plan-client.test.ts`

SQL signatures (from `supabase/migrations/20260912101000_monthly_budget_planning.sql`):
- `set_monthly_income_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency currency_code, p_amount_minor text, p_expected_revision_id bigint default null)` → `table(id bigint, month_start date)`
- `set_monthly_category_target(p_space_id, p_request_id, p_category_id uuid, p_month, p_currency, p_amount_minor text, p_expected_revision_id bigint default null)` → same
- `monthly_budget_currency_summary(p_space_id, p_month)` → columns: `currency, planned_income_minor, actual_income_minor, category_target_total_minor, category_actual_spent_minor, uncategorized_spent_minor, category_overspent_minor, actual_loan_repayment_minor, remaining_loan_reservation_minor, loan_commitment_minor, unallocated_minor, overallocated_minor, income_plan_revision_id`
- `monthly_budget_category_page(p_space_id, p_month, p_after_created_at timestamptz default null, p_after_category_id uuid default null, p_after_currency currency_code default null, p_limit integer default 50)` → columns: `category_id, name_en, name_ar, archived_at, currency, target_minor, actual_spent_minor, remaining_minor, overspent_minor, target_revision_id`

Both set-commands replay idempotently by `p_request_id` (see fingerprint logic in the migration and the replay tests in `tests/db/`); re-sending the same `requestId` after an ambiguous failure is safe.

- [ ] **Step 1: Write the failing test** — `src/features/plan/plan-client.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPlanClient } from './plan-client';

function rpcClient(impl: (name: string, args: Record<string, unknown>) => unknown) {
  return { rpc: vi.fn((name: string, args: Record<string, unknown>) => Promise.resolve(impl(name, args))) };
}

describe('createPlanClient', () => {
  it('maps monthly_budget_currency_summary rows to minor-unit strings', async () => {
    const client = createPlanClient(rpcClient(() => ({
      data: [{
        currency: 'USD', planned_income_minor: 210000, actual_income_minor: 210000,
        category_target_total_minor: 80000, category_actual_spent_minor: 30500,
        uncategorized_spent_minor: 1200, category_overspent_minor: 0,
        actual_loan_repayment_minor: 15000, remaining_loan_reservation_minor: 5000,
        loan_commitment_minor: 20000, unallocated_minor: 108300, overallocated_minor: 0,
        income_plan_revision_id: 7,
      }],
      error: null,
    })));
    const rows = await client.loadCurrencySummary('space-1', '2026-09-01');
    expect(rows).toEqual([{
      currency: 'USD', plannedIncomeMinor: '210000', actualIncomeMinor: '210000',
      categoryTargetTotalMinor: '80000', categoryActualSpentMinor: '30500',
      uncategorizedSpentMinor: '1200', categoryOverspentMinor: '0',
      actualLoanRepaymentMinor: '15000', remainingLoanReservationMinor: '5000',
      loanCommitmentMinor: '20000', unallocatedMinor: '108300', overallocatedMinor: '0',
      incomePlanRevisionId: '7',
    }]);
  });

  it('posts set_monthly_income_plan with snake_case args and returns the revision id', async () => {
    const rpc = rpcClient(() => ({ data: [{ id: 42, month_start: '2026-09-01' }], error: null }));
    const client = createPlanClient(rpc);
    await expect(client.setIncomePlan({
      spaceId: 'space-1', requestId: 'req-1', month: '2026-09-01',
      currency: 'USD', amountMinor: '210000', expectedRevisionId: '6',
    })).resolves.toEqual({ revisionId: '42' });
    expect(rpc.rpc).toHaveBeenCalledWith('set_monthly_income_plan', {
      p_space_id: 'space-1', p_request_id: 'req-1', p_month: '2026-09-01',
      p_currency: 'USD', p_amount_minor: '210000', p_expected_revision_id: 6,
    });
  });

  it('posts set_monthly_category_target with null expected revision when omitted', async () => {
    const rpc = rpcClient(() => ({ data: [{ id: 3, month_start: '2026-09-01' }], error: null }));
    const client = createPlanClient(rpc);
    await client.setCategoryTarget({
      spaceId: 'space-1', requestId: 'req-2', categoryId: 'cat-1',
      month: '2026-09-01', currency: 'LBP', amountMinor: '5000000',
    });
    expect(rpc.rpc).toHaveBeenCalledWith('set_monthly_category_target', {
      p_space_id: 'space-1', p_request_id: 'req-2', p_category_id: 'cat-1',
      p_month: '2026-09-01', p_currency: 'LBP', p_amount_minor: '5000000',
      p_expected_revision_id: null,
    });
  });

  it('maps monthly_budget_category_page rows and passes keyset cursor args', async () => {
    const rpc = rpcClient(() => ({
      data: [{
        category_id: 'cat-1', name_en: 'Groceries', name_ar: 'بقالة', archived_at: null,
        currency: 'USD', target_minor: 30000, actual_spent_minor: 21000,
        remaining_minor: 9000, overspent_minor: 0, target_revision_id: 11,
      }],
      error: null,
    }));
    const client = createPlanClient(rpc);
    const page = await client.loadCategoryPage('space-1', '2026-09-01', {
      afterCreatedAt: '2026-09-01T00:00:00Z', afterCategoryId: 'cat-0', afterCurrency: 'USD',
    });
    expect(rpc.rpc).toHaveBeenCalledWith('monthly_budget_category_page', {
      p_space_id: 'space-1', p_month: '2026-09-01',
      p_after_created_at: '2026-09-01T00:00:00Z', p_after_category_id: 'cat-0',
      p_after_currency: 'USD', p_limit: 50,
    });
    expect(page.rows[0]).toMatchObject({
      categoryId: 'cat-1', nameEn: 'Groceries', nameAr: 'بقالة',
      targetMinor: '30000', actualSpentMinor: '21000', targetRevisionId: '11',
    });
  });

  it('throws on rpc error and on malformed rows', async () => {
    const failing = createPlanClient(rpcClient(() => ({ data: null, error: { message: 'an active space membership is required' } })));
    await expect(failing.loadCurrencySummary('space-1', '2026-09-01')).rejects.toThrow('an active space membership is required');
    const malformed = createPlanClient(rpcClient(() => ({ data: [{ currency: 'EUR' }], error: null })));
    await expect(malformed.loadCurrencySummary('space-1', '2026-09-01')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/plan/plan-client.test.ts --config vitest.ui.config.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement** — `src/features/plan/types.ts`

```ts
import type { Currency } from '../loans/types';

export interface BudgetCurrencySummary {
  currency: Currency;
  plannedIncomeMinor: string;
  actualIncomeMinor: string;
  categoryTargetTotalMinor: string;
  categoryActualSpentMinor: string;
  uncategorizedSpentMinor: string;
  categoryOverspentMinor: string;
  actualLoanRepaymentMinor: string;
  remainingLoanReservationMinor: string;
  loanCommitmentMinor: string;
  unallocatedMinor: string;
  overallocatedMinor: string;
  incomePlanRevisionId: string | null;
}

export interface BudgetCategoryRow {
  categoryId: string;
  nameEn: string;
  nameAr: string;
  archivedAt: string | null;
  currency: Currency;
  targetMinor: string | null;
  actualSpentMinor: string;
  remainingMinor: string | null;
  overspentMinor: string;
  targetRevisionId: string | null;
}

export interface CategoryPageCursor {
  afterCreatedAt: string;
  afterCategoryId: string;
  afterCurrency: Currency;
}

export interface BudgetCategoryPage {
  rows: readonly BudgetCategoryRow[];
  nextCursor: CategoryPageCursor | null;
}

export interface SetIncomePlanInput {
  spaceId: string;
  requestId: string;
  month: string;
  currency: Currency;
  amountMinor: string;
  expectedRevisionId?: string | null;
}

export interface SetCategoryTargetInput extends SetIncomePlanInput {
  categoryId: string;
}

export interface PlanClient {
  loadCurrencySummary(spaceId: string, month: string): Promise<readonly BudgetCurrencySummary[]>;
  loadCategoryPage(spaceId: string, month: string, cursor?: CategoryPageCursor | null): Promise<BudgetCategoryPage>;
  setIncomePlan(input: SetIncomePlanInput): Promise<{ revisionId: string }>;
  setCategoryTarget(input: SetCategoryTargetInput): Promise<{ revisionId: string }>;
}
```

- [ ] **Step 4: Implement** — `src/features/plan/plan-client.ts`

Follow the existing gateway conventions: structural client interface `{ rpc(name, args): Promise<{ data, error }> }`, strict row validation, bigint-ish values coerced with `String(value)`. Write helpers `textValue`, `minorText`, `nullableMinorText`, `nullableIdText` locally (mirroring `src/features/wallets/supabase-wallets-gateway.ts` validation style — read that file's helpers first and copy the idiom, not the file).

```ts
import type {
  BudgetCategoryPage, BudgetCategoryRow, BudgetCurrencySummary, CategoryPageCursor,
  PlanClient, SetCategoryTargetInput, SetIncomePlanInput,
} from './types';
import type { Currency } from '../loans/types';

interface PlanDataClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

const CURRENCIES: readonly Currency[] = ['USD', 'LBP'];
const PAGE_LIMIT = 50;

function currencyValue(value: unknown): Currency {
  if (typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)) return value as Currency;
  throw new Error('Unexpected currency in plan response.');
}
function minorText(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  throw new Error('Unexpected minor amount in plan response.');
}
function nullableMinorText(value: unknown): string | null {
  return value === null ? null : minorText(value);
}
function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  throw new Error('Unexpected text in plan response.');
}
function nullableText(value: unknown): string | null {
  return value === null ? null : textValue(value);
}

async function call(client: PlanDataClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function summaryRow(row: unknown): BudgetCurrencySummary {
  const r = row as Record<string, unknown>;
  return {
    currency: currencyValue(r.currency),
    plannedIncomeMinor: minorText(r.planned_income_minor),
    actualIncomeMinor: minorText(r.actual_income_minor),
    categoryTargetTotalMinor: minorText(r.category_target_total_minor),
    categoryActualSpentMinor: minorText(r.category_actual_spent_minor),
    uncategorizedSpentMinor: minorText(r.uncategorized_spent_minor),
    categoryOverspentMinor: minorText(r.category_overspent_minor),
    actualLoanRepaymentMinor: minorText(r.actual_loan_repayment_minor),
    remainingLoanReservationMinor: minorText(r.remaining_loan_reservation_minor),
    loanCommitmentMinor: minorText(r.loan_commitment_minor),
    unallocatedMinor: minorText(r.unallocated_minor),
    overallocatedMinor: minorText(r.overallocated_minor),
    incomePlanRevisionId: nullableMinorText(r.income_plan_revision_id),
  };
}

function categoryRow(row: unknown): BudgetCategoryRow {
  const r = row as Record<string, unknown>;
  return {
    categoryId: textValue(r.category_id),
    nameEn: textValue(r.name_en),
    nameAr: textValue(r.name_ar),
    archivedAt: nullableText(r.archived_at),
    currency: currencyValue(r.currency),
    targetMinor: nullableMinorText(r.target_minor),
    actualSpentMinor: minorText(r.actual_spent_minor),
    remainingMinor: nullableMinorText(r.remaining_minor),
    overspentMinor: minorText(r.overspent_minor),
    targetRevisionId: nullableMinorText(r.target_revision_id),
  };
}

async function postPlan(client: PlanDataClient, name: string, input: SetIncomePlanInput | SetCategoryTargetInput) {
  const base = {
    p_space_id: input.spaceId,
    p_request_id: input.requestId,
    p_month: input.month,
    p_currency: input.currency,
    p_amount_minor: input.amountMinor,
    p_expected_revision_id: input.expectedRevisionId ? Number(input.expectedRevisionId) : null,
  };
  const args = 'categoryId' in input ? { ...base, p_category_id: input.categoryId } : base;
  const data = await call(client, name, args);
  const rows = data as Record<string, unknown>[];
  if (!Array.isArray(data) || rows.length !== 1) throw new Error('Plan command returned an unexpected result.');
  return { revisionId: minorText(rows[0].id) };
}

export function createPlanClient(client: PlanDataClient): PlanClient {
  return {
    async loadCurrencySummary(spaceId, month) {
      const data = await call(client, 'monthly_budget_currency_summary', { p_space_id: spaceId, p_month: month });
      if (!Array.isArray(data)) throw new Error('Unexpected currency summary shape.');
      return (data as unknown[]).map(summaryRow);
    },
    async loadCategoryPage(spaceId, month, cursor = null) {
      const data = await call(client, 'monthly_budget_category_page', {
        p_space_id: spaceId,
        p_month: month,
        p_after_created_at: cursor?.afterCreatedAt ?? null,
        p_after_category_id: cursor?.afterCategoryId ?? null,
        p_after_currency: cursor?.afterCurrency ?? null,
        p_limit: PAGE_LIMIT,
      });
      if (!Array.isArray(data)) throw new Error('Unexpected category page shape.');
      const rows = (data as unknown[]).map(categoryRow);
      // The SQL keyset-paginates by (created_at, category_id, currency); the page does not
      // echo created_at, so pagination continues while a full page is returned, using the
      // cursor of the last row loaded on the NEXT call. For v1 a single page is loaded;
      // nextCursor is null. (50 categories per month per space is the practical ceiling.)
      return { rows, nextCursor: null } satisfies BudgetCategoryPage;
    },
    setIncomePlan(input) {
      return postPlan(client, 'set_monthly_income_plan', input);
    },
    setCategoryTarget(input) {
      return postPlan(client, 'set_monthly_category_target', input);
    },
  };
}
```

Note: the test asserting keyset cursor args expects `p_limit: 50` and cursor passthrough — keep the implementation passing cursor args even though `nextCursor` is always `null` in v1.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/features/plan/plan-client.test.ts --config vitest.ui.config.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit + scope check**

```bash
pnpm check:uat:scope
git add src/features/plan && git commit -m "feat(plan): data client for monthly budget planning RPCs"
```

---

## Task 2: usePlan hook

**Files:**
- Create: `src/features/plan/use-plan.ts`
- Test: `src/features/plan/use-plan.test.tsx`
- Create: `src/test/in-memory-plan-client.ts`

- [ ] **Step 1: In-memory test double** — `src/test/in-memory-plan-client.ts`

```ts
import type { BudgetCategoryPage, BudgetCurrencySummary, PlanClient, SetCategoryTargetInput, SetIncomePlanInput } from '../features/plan/types';

export class InMemoryPlanClient implements PlanClient {
  summaries: BudgetCurrencySummary[] = [];
  categoryPage: BudgetCategoryPage = { rows: [], nextCursor: null };
  calls: Array<{ name: string; input: unknown }> = [];
  error: Error | null = null;
  private revision = 0;

  async loadCurrencySummary(): Promise<readonly BudgetCurrencySummary[]> {
    if (this.error) throw this.error;
    return this.summaries;
  }
  async loadCategoryPage(): Promise<BudgetCategoryPage> {
    if (this.error) throw this.error;
    return this.categoryPage;
  }
  async setIncomePlan(input: SetIncomePlanInput): Promise<{ revisionId: string }> {
    if (this.error) throw this.error;
    this.calls.push({ name: 'setIncomePlan', input });
    return { revisionId: String(++this.revision) };
  }
  async setCategoryTarget(input: SetCategoryTargetInput): Promise<{ revisionId: string }> {
    if (this.error) throw this.error;
    this.calls.push({ name: 'setCategoryTarget', input });
    return { revisionId: String(++this.revision) };
  }
}
```

- [ ] **Step 2: Write the failing test** — `src/features/plan/use-plan.test.tsx`

Use `@testing-library/react`'s `renderHook` + `act` (already available). Follow the async-hook test pattern used in `src/features/loans/use-loans.test.tsx` if one exists, otherwise:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InMemoryPlanClient } from '../../test/in-memory-plan-client';
import { usePlan } from './use-plan';

describe('usePlan', () => {
  it('loads summary and category rows for the current month', async () => {
    const client = new InMemoryPlanClient();
    client.summaries = [{ currency: 'USD', plannedIncomeMinor: '210000', actualIncomeMinor: '0',
      categoryTargetTotalMinor: '0', categoryActualSpentMinor: '0', uncategorizedSpentMinor: '0',
      categoryOverspentMinor: '0', actualLoanRepaymentMinor: '0', remainingLoanReservationMinor: '0',
      loanCommitmentMinor: '0', unallocatedMinor: '210000', overallocatedMinor: '0', incomePlanRevisionId: '1' }];
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.summaries[0].plannedIncomeMinor).toBe('210000');
  });

  it('setIncomePlan posts with a generated request id and refreshes', async () => {
    const client = new InMemoryPlanClient();
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01', () => 'req-fixed'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.setIncomePlan({ currency: 'USD', amountMinor: '100000', expectedRevisionId: null });
    });
    expect(client.calls[0]).toMatchObject({ name: 'setIncomePlan' });
    expect((client.calls[0].input as { requestId: string }).requestId).toBe('req-fixed');
    expect(result.current.status).toBe('ready');
  });

  it('surfaces load errors with retry', async () => {
    const client = new InMemoryPlanClient();
    client.error = new Error('connection timeout');
    const { result } = renderHook(() => usePlan(client, 'space-1', '2026-09-01'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    client.error = null;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`pnpm vitest run src/features/plan/use-plan.test.tsx --config vitest.ui.config.ts`)

- [ ] **Step 4: Implement** — `src/features/plan/use-plan.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BudgetCategoryRow, BudgetCurrencySummary, PlanClient } from './types';
import type { Currency } from '../loans/types';

const defaultCreateRequestId = () => crypto.randomUUID();

export interface PlanState {
  status: 'loading' | 'ready' | 'error';
  summaries: readonly BudgetCurrencySummary[];
  categoryRows: readonly BudgetCategoryRow[];
  pending: boolean;
  error: string | null;
  refresh(): Promise<void>;
  setIncomePlan(input: { currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
  setCategoryTarget(input: { categoryId: string; currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
}

export function usePlan(
  client: PlanClient,
  spaceId: string,
  month: string,
  createRequestId: () => string = defaultCreateRequestId,
): PlanState {
  const [status, setStatus] = useState<PlanState['status']>('loading');
  const [summaries, setSummaries] = useState<readonly BudgetCurrencySummary[]>([]);
  const [categoryRows, setCategoryRows] = useState<readonly BudgetCategoryRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const [summaryRows, categoryPage] = await Promise.all([
        client.loadCurrencySummary(spaceId, month),
        client.loadCategoryPage(spaceId, month),
      ]);
      if (sequence.current !== request) return;
      setSummaries(summaryRows);
      setCategoryRows(categoryPage.rows);
      setError(null);
      setStatus('ready');
    } catch (cause) {
      if (sequence.current !== request) return;
      setError(cause instanceof Error ? cause.message : 'Could not load the monthly plan.');
      setStatus('error');
    }
  }, [client, spaceId, month]);

  useEffect(() => {
    setStatus('loading');
    void load();
  }, [load]);

  const post = useCallback(async (fn: (requestId: string) => Promise<unknown>): Promise<boolean> => {
    // Plan commands replay idempotently by request id, so a caller may retry this
    // promise after an ambiguous transport failure without double-posting.
    setPending(true);
    try {
      await fn(createRequestId());
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the plan.');
      return false;
    } finally {
      setPending(false);
    }
  }, [createRequestId, load]);

  return {
    status, summaries, categoryRows, pending, error,
    refresh: load,
    setIncomePlan: (input) => post((requestId) => client.setIncomePlan({ spaceId, requestId, month, ...input })),
    setCategoryTarget: (input) => post((requestId) => client.setCategoryTarget({ spaceId, requestId, month, ...input })),
  };
}
```

- [ ] **Step 5: Run — expect PASS.** Then commit:

```bash
pnpm check:uat:scope
git add src/features/plan src/test/in-memory-plan-client.ts && git commit -m "feat(plan): usePlan hook with idempotent plan posting"
```

---

## Task 3: Insights data client

**Files:**
- Create: `src/features/insights/types.ts`
- Create: `src/features/insights/insights-client.ts`
- Test: `src/features/insights/insights-client.test.ts`

SQL signatures (from `supabase/migrations/20260912102000_reporting_read_models.sql`):
- `report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid default null, p_currency currency_code default null, p_event_limit integer default 50)` → `event_id, kind, effective_date, created_at, reversal_of, wallet_id, wallet_name, currency, amount_minor, has_more`
- `report_category_actual_vs_budget(p_space_id uuid, p_month date)` → `category_key, category_name_en, category_name_ar, category_kind, currency, actual_net_minor, budget_minor, remaining_minor`

- [ ] **Step 1: Write the failing test** — mirror Task 1's test style. Cases: (a) maps `report_wallet_activity` rows camelCase and passes all five args (nulls for omitted filters, `p_event_limit: 50`); (b) maps `report_category_actual_vs_budget` rows; (c) throws on rpc error; (d) throws on malformed `kind`. Event kinds to accept: `'opening' | 'income' | 'expense' | 'transfer' | 'exchange' | 'loan' | 'repayment' | 'reversal'` — verify the exact enum by reading `financial_event_kind` in `supabase/migrations/20260907110000_wallet_journal.sql` and `20260907140000_loan_event_kind.sql` before writing the test; use the real enum values.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `types.ts`:

```ts
import type { Currency } from '../loans/types';

export type ReportEventKind = /* the exact financial_event_kind enum values from the migrations */;

export interface WalletActivityRow {
  eventId: string;
  kind: ReportEventKind;
  effectiveDate: string;
  createdAt: string;
  reversalOf: string | null;
  walletId: string;
  walletName: string;
  currency: Currency;
  amountMinor: string;
  hasMore: boolean;
}

export interface CategoryBudgetRow {
  categoryKey: string;
  nameEn: string;
  nameAr: string;
  kind: 'income' | 'expense';
  currency: Currency;
  actualNetMinor: string;
  budgetMinor: string | null;
  remainingMinor: string | null;
}

export interface InsightsClient {
  walletActivity(input: {
    spaceId: string; fromDate: string; toDate: string;
    walletId?: string | null; currency?: Currency | null; limit?: number;
  }): Promise<readonly WalletActivityRow[]>;
  categoryActualVsBudget(spaceId: string, month: string): Promise<readonly CategoryBudgetRow[]>;
}
```

`insights-client.ts` follows the exact same `call`/validation idiom as `plan-client.ts` (Task 1). Defaults: `p_wallet_id: null`, `p_currency: null`, `p_event_limit: 50`.

- [ ] **Step 4: Run — expect PASS.** Create `src/test/in-memory-insights-client.ts` (same shape as the plan double: settable `activity`/`budgetRows` arrays, `error`, `calls` log). Commit:

```bash
pnpm check:uat:scope
git add src/features/insights src/test/in-memory-insights-client.ts && git commit -m "feat(insights): data client for reporting read models"
```

---

## Task 4: Exchange client + useExchange

**Files:**
- Create: `src/features/exchange/types.ts`
- Create: `src/features/exchange/exchange-client.ts`
- Create: `src/features/exchange/use-exchange.ts`
- Create: `src/test/in-memory-exchange-client.ts`
- Tests: `src/features/exchange/exchange-client.test.ts`, `src/features/exchange/use-exchange.test.tsx`

SQL: `record_usd_to_lbp_exchange(p_space_id uuid, p_request_id uuid, p_usd_wallet_id uuid, p_lbp_wallet_id uuid, p_usd_amount_minor text, p_lbp_amount_minor text, p_effective_date date)` → `table(id uuid)`.

- [ ] **Step 1: Failing client test** — one happy-path case asserting snake_case args and `{ eventId }` return, one error case.

- [ ] **Step 2: Implement client** (`ExchangeClient.recordExchange(input): Promise<{ eventId: string }>`), same idiom as Tasks 1/3.

- [ ] **Step 3: Failing hook test** — `useExchange(exchangeClient, walletsGateway-ish, spaceId)`:

```tsx
it('returns ambiguous and reconciles via findEventByRequestId after a transport failure', async () => {
  // fake exchangeClient.recordExchange rejects with new TypeError('Failed to fetch')
  // fake receipts.findEventByRequestId resolves a JournalEvent-shaped object
  // expect first call → { status: 'ambiguous' }; retryAmbiguous() → { status: 'success', reconciled: true }
});
```

- [ ] **Step 4: Implement hook.** Model it directly on the `reconcileCommand` pattern in `src/features/wallets/use-wallets.ts` (read lines ~230-340 first). The hook signature:

```ts
export interface ExchangeDraft {
  usdWalletId: string; lbpWalletId: string;
  usdAmountMinor: string; lbpAmountMinor: string; effectiveDate: string;
}
export type ExchangeOutcome = { status: 'success' | 'ambiguous'; reconciled: boolean };

export function useExchange(
  client: ExchangeClient,
  receipts: { findEventByRequestId(spaceId: string, requestId: string): Promise<unknown | null> },
  spaceId: string,
  onRecorded: () => Promise<void> | void,
  createRequestId: () => string = () => crypto.randomUUID(),
): {
  pending: boolean;
  ambiguous: { requestId: string } | null;
  recordExchange(draft: ExchangeDraft): Promise<ExchangeOutcome>;
  retryAmbiguous(): Promise<ExchangeOutcome>;
  clearAmbiguous(): void;
}
```

Behavior: generate `requestId`; on success → `await onRecorded()` (caller refreshes wallets), return `{ status: 'success', reconciled: false }`. On transport-shaped failure (`/network|failed to fetch|load failed|connection|timeout/i`): call `receipts.findEventByRequestId(spaceId, requestId)`; found → refresh + `{ status: 'success', reconciled: true }`; not found → keep `{ requestId, draft }` in state, return `{ status: 'ambiguous', reconciled: false }`; `retryAmbiguous()` re-sends with the SAME `requestId`. Non-transport errors rethrow to the caller (the sheet shows the server message).

- [ ] **Step 5: Tests PASS, then commit**

```bash
pnpm check:uat:scope
git add src/features/exchange src/test/in-memory-exchange-client.ts && git commit -m "feat(exchange): USD→LBP exchange client and hook with receipt retry"
```

---

## Task 5: Control Room theme (light) + base CSS

**Files:**
- Create: `src/control-room.css`
- Modify: `src/main.tsx` (add one import line)

- [ ] **Step 1: Create the stylesheet.** All new UI uses `cr-` prefixed classes so it cannot collide with the legacy styles (which remain until Task 14). Logical properties only.

```css
/* Control Room theme — light-first. All colors are tokens; a future dark theme
   swaps this block only. */
:root {
  color-scheme: light;
  --cr-bg: #f7f6f2;
  --cr-surface: #ffffff;
  --cr-surface-sunken: #efede6;
  --cr-border: #e3e0d7;
  --cr-ink: #1c1a15;
  --cr-ink-soft: #6b675c;
  --cr-accent: #1a7a4a;
  --cr-accent-strong: #0f5a36;
  --cr-accent-soft: #e2f1e9;
  --cr-accent-ink: #ffffff;
  --cr-warn: #9a6206;
  --cr-warn-soft: #faf0da;
  --cr-danger: #b3261e;
  --cr-danger-soft: #fbe9e7;
  --cr-radius: 14px;
  --cr-radius-sm: 10px;
  --cr-tabbar-h: 64px;
  --cr-shadow: 0 1px 2px rgb(28 26 21 / 0.06), 0 4px 16px rgb(28 26 21 / 0.06);
}

/* Shell layout */
.cr-shell { min-height: 100dvh; background: var(--cr-bg); color: var(--cr-ink); display: flex; flex-direction: column; }
.cr-main { flex: 1; inline-size: 100%; max-inline-size: 720px; margin-inline: auto; padding: var(--space-4, 16px); padding-block-end: calc(var(--cr-tabbar-h) + 24px); }
.cr-main--wide { max-inline-size: 960px; }

/* Bottom tab bar (mobile-first) */
.cr-tabbar {
  position: fixed; inset-inline: 0; inset-block-end: 0; z-index: 30;
  display: flex; align-items: stretch; justify-content: space-around;
  min-height: var(--cr-tabbar-h);
  background: var(--cr-surface); border-block-start: 1px solid var(--cr-border);
  padding-block-end: env(safe-area-inset-bottom);
}
.cr-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  background: none; border: 0; color: var(--cr-ink-soft);
  font-size: 11px; font-weight: 600; min-height: 44px;
}
.cr-tab--active { color: var(--cr-accent-strong); }
.cr-tab-fab { flex: 1; display: flex; align-items: center; justify-content: center; background: none; border: 0; }
.cr-fab {
  inline-size: 52px; block-size: 52px; border-radius: 50%; border: 0;
  background: var(--cr-accent); color: var(--cr-accent-ink);
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: var(--cr-shadow); margin-block-start: -18px;
}

/* Desktop rail (>=1024px): tab bar becomes a left rail (right rail in RTL via logical properties) */
.cr-rail { display: none; }
@media (min-width: 1024px) {
  .cr-shell { flex-direction: row; }
  .cr-rail {
    display: flex; flex-direction: column; gap: 4px; flex: 0 0 240px;
    padding: 20px 12px; border-inline-end: 1px solid var(--cr-border); background: var(--cr-surface);
    position: sticky; inset-block-start: 0; block-size: 100dvh;
  }
  .cr-rail .cr-tab { flex-direction: row; justify-content: flex-start; gap: 10px; padding-inline: 12px; border-radius: var(--cr-radius-sm); font-size: 14px; }
  .cr-rail .cr-tab--active { background: var(--cr-accent-soft); }
  .cr-tabbar { display: none; }
  .cr-main { padding-block-end: var(--space-4, 16px); }
}

/* Cards and data display */
.cr-card { background: var(--cr-surface); border: 1px solid var(--cr-border); border-radius: var(--cr-radius); padding: 14px 16px; box-shadow: var(--cr-shadow); }
.cr-card + .cr-card { margin-block-start: 10px; }
.cr-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cr-ink-soft); }
.cr-amount { font-variant-numeric: tabular-nums; font-weight: 800; }
.cr-amount--hero { font-size: 32px; }
.cr-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.cr-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.cr-chip { border: 1px solid var(--cr-border); border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600; background: var(--cr-surface); color: var(--cr-ink-soft); }
.cr-chip--active { background: var(--cr-accent-soft); border-color: var(--cr-accent); color: var(--cr-accent-strong); }
.cr-positive { color: var(--cr-accent-strong); }
.cr-warn-text { color: var(--cr-warn); }
.cr-danger-text { color: var(--cr-danger); }

/* Budget progress */
.cr-progress { block-size: 6px; border-radius: 3px; background: var(--cr-surface-sunken); overflow: hidden; }
.cr-progress > span { display: block; block-size: 100%; background: var(--cr-accent); border-radius: inherit; }
.cr-progress--over > span { background: var(--cr-warn); }

/* Trend bars */
.cr-bars { display: flex; align-items: flex-end; gap: 4px; block-size: 56px; }
.cr-bars > span { flex: 1; background: var(--cr-accent); opacity: 0.85; border-radius: 3px 3px 0 0; min-block-size: 2px; }
.cr-bars > span[data-role="previous"] { opacity: 0.35; }

/* Journal feed */
.cr-journal-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-block: 10px; border-block-end: 1px solid var(--cr-border); font-size: 14px; }
.cr-journal-row:last-child { border-block-end: 0; }

/* Bottom sheet (record flow + entry detail) */
.cr-sheet-backdrop { position: fixed; inset: 0; background: rgb(28 26 21 / 0.4); z-index: 40; display: flex; align-items: flex-end; justify-content: center; }
.cr-sheet {
  background: var(--cr-surface); inline-size: 100%; max-inline-size: 560px;
  border-radius: var(--cr-radius) var(--cr-radius) 0 0; padding: 16px;
  max-block-size: 88dvh; overflow-y: auto;
}
@media (min-width: 1024px) {
  .cr-sheet-backdrop { align-items: center; }
  .cr-sheet { border-radius: var(--cr-radius); }
}
.cr-type-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.cr-type-tile { border: 1px solid var(--cr-border); border-radius: var(--cr-radius-sm); background: var(--cr-surface); padding: 12px 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--cr-ink); }
.cr-type-tile[aria-pressed="true"] { border-color: var(--cr-accent); background: var(--cr-accent-soft); }

/* Keypad */
.cr-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; direction: ltr; }
.cr-keypad button { min-height: 52px; border: 0; border-radius: var(--cr-radius-sm); background: var(--cr-surface-sunken); font-size: 20px; font-weight: 700; color: var(--cr-ink); font-variant-numeric: tabular-nums; }

/* Buttons */
.cr-button { min-height: 44px; border-radius: var(--cr-radius-sm); border: 1px solid var(--cr-border); background: var(--cr-surface); color: var(--cr-ink); font-weight: 700; padding-inline: 16px; }
.cr-button--primary { background: var(--cr-accent); border-color: var(--cr-accent); color: var(--cr-accent-ink); }
.cr-button--primary:disabled { opacity: 0.5; }
.cr-button--danger { color: var(--cr-danger); border-color: var(--cr-danger); background: var(--cr-danger-soft); }
.cr-button--block { inline-size: 100%; }
```

- [ ] **Step 2: Import it.** In `src/main.tsx`, directly under the existing `import './styles.css';` line, add:

```ts
import './control-room.css';
```

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm build` pass. Commit:

```bash
git add src/control-room.css src/main.tsx && git commit -m "feat(control-room): light theme tokens and base component styles"
```

---

## Task 6: Control Room shell + navigation, wired into app.tsx

**Files:**
- Create: `src/features/control-room/types.ts`
- Create: `src/features/control-room/control-room-shell.tsx`
- Create: `src/features/control-room/control-room-shell.test.tsx`
- Modify: `src/app.tsx` (swap shell + destination state; keep everything else)
- Modify: `src/app.test.tsx` (update navigation expectations)

- [ ] **Step 1: types** — `src/features/control-room/types.ts`

```ts
export type ControlRoomDestination = 'home' | 'journal' | 'plan' | 'manage';
```

- [ ] **Step 2: Failing test** — `src/features/control-room/control-room-shell.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ControlRoomShell } from './control-room-shell';

const baseProps = {
  locale: 'en' as const,
  userEmail: 'daniel@example.com',
  activeDestination: 'home' as const,
  onDestinationChange: vi.fn(),
  onLocaleChange: vi.fn(),
  onSignOut: vi.fn(),
  onRecord: vi.fn(),
  spaceControls: <div>space controls</div>,
};

describe('ControlRoomShell', () => {
  it('renders five tab-bar slots with the record action in the center', () => {
    render(<ControlRoomShell {...baseProps}>content</ControlRoomShell>);
    for (const name of ['Home', 'Journal', 'Plan', 'Manage']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('marks the active destination and reports changes', async () => {
    const user = userEvent.setup();
    const onDestinationChange = vi.fn();
    render(<ControlRoomShell {...baseProps} onDestinationChange={onDestinationChange}>x</ControlRoomShell>);
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Journal' }));
    expect(onDestinationChange).toHaveBeenCalledWith('journal');
  });

  it('record button calls onRecord, not navigation', async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    const onDestinationChange = vi.fn();
    render(<ControlRoomShell {...baseProps} onRecord={onRecord} onDestinationChange={onDestinationChange}>x</ControlRoomShell>);
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onDestinationChange).not.toHaveBeenCalled();
  });

  it('renders Arabic labels when locale is ar', () => {
    render(<ControlRoomShell {...baseProps} locale="ar">x</ControlRoomShell>);
    expect(screen.getByRole('button', { name: 'الرئيسية' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'سجل' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** — `src/features/control-room/control-room-shell.tsx`

```tsx
import type { ReactNode } from 'react';
import { LayoutDashboard, ScrollText, Plus, Target, Settings2 } from 'lucide-react';
import type { Locale } from '../loans/types';
import type { ControlRoomDestination } from './types';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

const DESTINATIONS: readonly { id: ControlRoomDestination; icon: typeof LayoutDashboard; en: string; ar: string }[] = [
  { id: 'home', icon: LayoutDashboard, en: 'Home', ar: 'الرئيسية' },
  { id: 'journal', icon: ScrollText, en: 'Journal', ar: 'دفتر اليومية' },
  { id: 'plan', icon: Target, en: 'Plan', ar: 'الخطة' },
  { id: 'manage', icon: Settings2, en: 'Manage', ar: 'الإدارة' },
];

export interface ControlRoomShellProps {
  locale: Locale;
  userEmail: string | null;
  activeDestination: ControlRoomDestination;
  onDestinationChange(destination: ControlRoomDestination): void;
  onLocaleChange(): void;
  onSignOut(): void;
  onRecord(): void;
  /** Space switcher + month selector etc., supplied by the caller (reuses SpaceSwitcher from features/shell). */
  spaceControls: ReactNode;
  children: ReactNode;
}

export function ControlRoomShell(props: ControlRoomShellProps) {
  const { locale, activeDestination, onDestinationChange, onRecord } = props;
  const tabs = (
    <>
      {DESTINATIONS.slice(0, 2).map(renderTab)}
      <div className="cr-tab-fab">
        <button type="button" className="cr-fab" aria-label={t(locale, 'Record', 'سجل')} onClick={onRecord}>
          <Plus aria-hidden size={26} />
        </button>
      </div>
      {DESTINATIONS.slice(2).map(renderTab)}
    </>
  );
  function renderTab({ id, icon: Icon, en, ar }: (typeof DESTINATIONS)[number]) {
    const active = activeDestination === id;
    return (
      <button
        key={id}
        type="button"
        className={active ? 'cr-tab cr-tab--active' : 'cr-tab'}
        aria-current={active ? 'page' : undefined}
        onClick={() => onDestinationChange(id)}
      >
        <Icon aria-hidden size={20} />
        {t(locale, en, ar)}
      </button>
    );
  }
  return (
    <div className="cr-shell">
      <nav className="cr-rail" aria-label={t(locale, 'Workspace', 'مساحة العمل')}>
        {props.spaceControls}
        {tabs}
      </nav>
      <main className="cr-main">{props.children}</main>
      <nav className="cr-tabbar" aria-label={t(locale, 'Workspace', 'مساحة العمل')}>{tabs}</nav>
    </div>
  );
}
```

Note the same `tabs` render twice (rail + tab bar); give each nav its own container as above. In the test, duplicate buttons match by role — `getByRole` with a name will find two. Fix the test to use `getAllByRole(...)[0]` where needed, or mark the rail `aria-hidden` on mobile only via CSS (display:none) — Testing Library still sees it. Simplest: in tests use `getAllByRole('button', { name: 'Home' })[0]` and click `[1]` variants as needed. Adjust the test code accordingly when implementing.

- [ ] **Step 5: Wire into app.tsx.** In `AuthenticatedWorkspace`:
  - Change `useState<ApplicationDestination>` to `useState<ControlRoomDestination>('home')`.
  - Remove the household-destination redirect effect (household now lives inside Manage).
  - Add `const [recordOpen, setRecordOpen] = useState(false)`.
  - Replace `<ApplicationShell ...><WorkspaceRoutes .../></ApplicationShell>` with:

```tsx
<ControlRoomShell
  locale={locale}
  userEmail={auth.user?.email ?? null}
  activeDestination={destination}
  onDestinationChange={setDestination}
  onLocaleChange={onLocaleChange}
  onSignOut={auth.signOut}
  onRecord={() => setRecordOpen(true)}
  spaceControls={
    <SpaceSwitcher
      locale={locale}
      spaces={workspace.spaces}
      selectedSpace={workspace.selectedSpace}
      onSpaceChange={workspace.selectSpace}
      onAddSpace={() => setOnboardingOpen(true)}
    />
  }
>
  <ControlRoomRoutes
    locale={locale}
    spaceId={workspace.selectedSpace.id}
    spaceKind={workspace.selectedSpace.kind}
    destination={destination}
    gateways={{ wallets: walletsGateway, loans: loansGateway, categories: categoriesGateway, reports: reportsGateway, household: householdGateway, plan: planClient, insights: insightsClient, exchange: exchangeClient }}
    recordOpen={recordOpen}
    onCloseRecord={() => setRecordOpen(false)}
  />
</ControlRoomShell>
```

  - Construct the three new clients in `App` alongside the existing `useMemo` gateways: `createPlanClient(client)`, `createInsightsClient(client)`, `createExchangeClient(client)` over the same Supabase data client; add optional `AppProps` overrides for tests (same injection pattern as existing gateways).
  - Keep the existing `OnboardingDialog` flow unchanged (it manages first-space creation); if the shell previously owned "add space", keep that wiring working through `spaceControls`.

- [ ] **Step 6: Update `src/app.test.tsx`.** The existing tests reference old navigation names ("Overview", "Wallets", "Loans", "Reports", "Categories", "Household"). Replace destination expectations with the new tab names (Home/Journal/Plan/Manage). Signed-in flows that drilled into old pages now go through Manage — update those paths to click **Manage** then the section. Run `pnpm test:ui` until green.

- [ ] **Step 7: Commit**

```bash
pnpm check:uat:scope
git add src/features/control-room src/app.tsx src/app.test.tsx && git commit -m "feat(control-room): shell with tab bar navigation wired into app"
```

(`ControlRoomRoutes` is created in Task 7; for Task 6 a minimal placeholder `routes.tsx` that renders `<p>coming soon</p>` per destination is acceptable to keep the build green — it is fully replaced in Tasks 7–11.)

---

## Task 7: Home dashboard screen

**Files:**
- Create: `src/features/control-room/routes.tsx` (if not yet) and `src/features/control-room/home-screen.tsx`
- Test: `src/features/control-room/home-screen.test.tsx`

Data sources (all existing or built in Tasks 1–4):
- Net position + wallets: `useWallets(...).wallets` → group `balanceMinor` per currency (bigint sum via `BigInt`).
- Budget vs actual: `usePlan(...).summaries` + `insights.categoryActualVsBudget(spaceId, month)`.
- Trend: existing `ReportsGateway.loadMonthlyComparison(spaceId, month)` (2 months × 2 currencies; render previous months as faded bars, current as solid — 4 bars per currency, or a compact 2×2).
- Loans snapshot: `useLoans(...)` dashboard (`loans`, `currencySummaries` — read `src/features/loans/use-loans.ts` for exact field names).
- Recent activity: `useWallets(...).events` (first 5).

- [ ] **Step 1: Failing test** — `home-screen.test.tsx`. Render `HomeScreen` with plain prop objects (no hooks — the screen is a pure component; hook wiring lives in `routes.tsx`). Assert: net position hero shows formatted totals per currency; a category over budget renders with `cr-warn-text`; "No transactions yet" empty state when `recentEvents` is empty; Arabic renders `ل.ل` amounts via `formatMinorAmount`.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeScreen } from './home-screen';

const props = {
  locale: 'en' as const,
  month: '2026-09-01',
  onMonthChange: vi.fn(),
  onRecord: vi.fn(),
  totals: [{ currency: 'USD' as const, balanceMinor: '128450' }, { currency: 'LBP' as const, balanceMinor: '86700000' }],
  budgets: [{
    categoryKey: 'groceries', nameEn: 'Groceries', nameAr: 'بقالة', kind: 'expense' as const,
    currency: 'USD' as const, actualNetMinor: '21000', budgetMinor: '30000', remainingMinor: '9000',
  }],
  trend: [], loansOutstanding: [], recentEvents: [],
};

describe('HomeScreen', () => {
  it('shows net position per currency and the month label', () => {
    render(<HomeScreen {...props} />);
    expect(screen.getByText('$1,284.50')).toBeInTheDocument();
    expect(screen.getByText(/Groceries/)).toBeInTheDocument();
  });
  it('shows the empty journal state', () => {
    render(<HomeScreen {...props} />);
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `home-screen.tsx`.** Pure presentational component; exact props as in the test plus:

```tsx
export interface HomeScreenProps {
  locale: Locale;
  month: string; // YYYY-MM-01
  onMonthChange(month: string): void;
  onRecord(): void;
  totals: readonly { currency: Currency; balanceMinor: string }[];
  budgets: readonly CategoryBudgetRow[];        // from insights
  trend: readonly MonthlyCashSummary[];         // from reports gateway
  loansOutstanding: readonly { loanId: string; personName: string; currency: Currency; outstandingMinor: string }[];
  recentEvents: readonly JournalEvent[];        // from wallets gateway types
}
```

Layout order: header (space label + month `<select>` of the last 12 first-of-month strings) → net position hero (sum per currency, `formatMinorAmount`, `cr-amount--hero`) → currency chips → Budget vs actual card (per row: name, `formatMinorAmount(actual) / formatMinorAmount(budget)`, `cr-progress` with `cr-progress--over` when `remainingMinor` negative — compare with `BigInt`) → Trend card (`cr-bars`, bar heights normalized to max `expenseNetMinor`) → Loans card (count + outstanding per currency, hidden when empty) → Recent activity (first 5 events: payee/category/kind label + signed amount colored `cr-positive` for income, plain negative otherwise; empty → "No transactions yet" / «لا توجد معاملات بعد»).

- [ ] **Step 3: Wire in `routes.tsx`.** `ControlRoomRoutes` owns all hooks once and passes data down:

```tsx
export function ControlRoomRoutes(props: {
  locale: Locale;
  spaceId: string;
  spaceKind: Space['kind'];
  destination: ControlRoomDestination;
  gateways: { /* as in Task 6 wiring */ };
  recordOpen: boolean;
  onCloseRecord(): void;
}) {
  const month = useState(() => currentMonthStart()); // helper: new Date() → `${y}-${m}-01`
  const wallets = useWallets(props.gateways.wallets, props.spaceId, undefined, undefined, props.gateways.categories);
  const plan = usePlan(props.gateways.plan, props.spaceId, month[0]);
  const loans = useLoans(props.gateways.loans /* options per existing signature */);
  // trend: load via useEffect on [spaceId, month] with props.gateways.reports.loadMonthlyComparison
  // budgets: load via useEffect with props.gateways.insights.categoryActualVsBudget
  // switch on props.destination: home → HomeScreen, journal → JournalScreen,
  // plan → PlanPage, manage → ManageScreen; plus <RecordSheet open={recordOpen} ... />
}
```

Guard async loads with a request counter (pattern from `use-workspace.ts`).

- [ ] **Step 4: `pnpm test:ui` green; commit**

```bash
git add src/features/control-room && git commit -m "feat(control-room): home dashboard screen"
```

---

## Task 8: Journal screen

**Files:**
- Create: `src/features/control-room/journal-screen.tsx`
- Test: `src/features/control-room/journal-screen.test.tsx`

- [ ] **Step 1: Failing test.** Cases: renders events with payee/category labels and signed formatted amounts; filter chips (All / Income / Expense / Transfer / Exchange / Loans) filter the list client-side; clicking a row opens the detail sheet showing note, linked movements, and a **Reverse** button for eligible events (`reversalOf === null && reversedBy === null` — read `JournalEvent` in `src/features/wallets/types.ts` for exact fields); reversing calls the injected `onReverse(eventId)`; a reversed event renders its reversal link and disables Reverse.

- [ ] **Step 2: Implement.** Pure component:

```tsx
export interface JournalScreenProps {
  locale: Locale;
  events: readonly JournalEvent[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore(): void;
  onReverse(eventId: string): Promise<unknown>;
  reversePending: boolean;
}
```

Local state: `kindFilter: 'all' | JournalEventKind` and `selected: JournalEvent | null` (detail sheet). Rows use `.cr-journal-row`; amounts colored `cr-positive` for income/repayment-in, danger-muted for reversals (`reversalOf !== null` → prefix label "Reversal of" / «عكس قيد»). Detail sheet uses `.cr-sheet-backdrop`/`.cr-sheet`, Escape + backdrop click close, focus returns to the row (mirror `expectDialogReturnsFocus` semantics from `e2e/workspace-contract.ts`). "Load more" button when `nextCursor` non-null.

- [ ] **Step 3: Wire in routes.tsx** — `journal` destination: `<JournalScreen events={wallets.events} nextCursor={wallets.nextCursor} loadingMore={wallets.loadingMore} onLoadMore={wallets.loadMore} onReverse={(id) => wallets.reverseEvent({ eventId: id, effectiveDate: todayIso() })} reversePending={wallets.pending} />` — check the exact `reverseEvent` draft shape in `use-wallets.ts` (`ReverseEventInput` minus spaceId/requestId) and match it. Surface `wallets.ambiguous` with the retry UI (banner with "Check again" → `retryAmbiguous()`, dismiss → `clearAmbiguous()`); the same banner component is reused on all screens — put it in `src/features/control-room/ambiguous-banner.tsx`.

- [ ] **Step 4: Tests green; commit** `"feat(control-room): journal screen with entry detail and reversal"`.

---

## Task 9: Record sheet (the core write flow)

**Files:**
- Create: `src/features/control-room/record-sheet.tsx`
- Test: `src/features/control-room/record-sheet.test.tsx`

This is the most intricate component. Full state machine below — implement exactly this shape.

- [ ] **Step 1: Failing tests** (each its own `it`):
  1. Closed (`open={false}`) renders nothing.
  2. Opens on the type grid with 7 tiles: Expense, Income, Transfer, Exchange, Lend, Borrow, Repay (Arabic: مصروف، دخل، تحويل، صرف، إقراض، استدانة، سداد).
  3. Expense flow: type → amount keypad (`1` `2` `.` `5` → displays 12.5, max one decimal separator, digits append) → wallet picker (only active wallets of the selected currency) → category picker (expense roots; expandable rows show subcategories; "Skip" allowed) → details (payee input with datalist from `payees`, note input) → confirm screen summarizes "Expense · $12.50 · Cash · Groceries" → submit calls `onSubmitRecord` with `{ kind: 'expense', effectiveDate, movements: [{ walletId, amountMinor: '-1250' }], categoryId, payeeName, note }` (expense amounts are NEGATIVE minor units; income positive; transfer has exactly two movements: negative source, positive destination, same currency — verify the sign convention in `tests/db` wallet journal tests before finalizing).
  4. Transfer requires two distinct wallets of the same currency; the confirm button is disabled until both picked.
  5. Exchange flow shows two amount fields (USD out, LBP in) and two wallet pickers filtered by currency; submit calls `onSubmitExchange`.
  6. Lend/Borrow: amount → wallet → person name → optional due date + note → submit calls `onSubmitLoan` with `mode: 'cash'`, `direction: 'lent' | 'borrowed'` (check exact direction enum in `src/features/loans/types.ts`).
  7. Repay: pick from outstanding loans list → amount → wallet → submit calls `onSubmitRepayment`.
  8. Submit failure rethrows from the hook → the sheet stays open and shows the server message inline.
  9. Success → `onClose()` is called (parent refreshes and closes).

- [ ] **Step 2: Implement.** State machine:

```tsx
type RecordKind = 'expense' | 'income' | 'transfer' | 'exchange' | 'lend' | 'borrow' | 'repay';
type Step = 'type' | 'amount' | 'wallet' | 'category' | 'details' | 'confirm';

interface RecordSheetProps {
  open: boolean;
  locale: Locale;
  wallets: readonly WalletProjection[];             // active wallets
  loans: readonly { loanId: string; personName: string; currency: Currency; outstandingMinor: string }[];
  payees: readonly string[];
  categoryTree: readonly { id: string; nameEn: string; nameAr: string; kind: 'income' | 'expense'; children: readonly { id: string; nameEn: string; nameAr: string }[] }[];
  pending: boolean;
  error: string | null;
  onClose(): void;
  onSubmitRecord(draft: {
    kind: 'expense' | 'income' | 'transfer';
    effectiveDate: string;
    movements: readonly { walletId: string; amountMinor: string }[];
    categoryId: string | null; payeeName: string | null; note: string | null;
  }): Promise<unknown>;
  onSubmitExchange(draft: ExchangeDraft): Promise<unknown>;
  onSubmitLoan(draft: {
    direction: 'lent' | 'borrowed'; personName: string; currency: Currency;
    walletId: string; amountMinor: string; effectiveDate: string; dueDate: string | null; note: string | null;
  }): Promise<unknown>;
  onSubmitRepayment(draft: {
    loanId: string; walletId: string; amountMinor: string; effectiveDate: string;
  }): Promise<unknown>;
}
```

Internals: `const [kind, setKind] = useState<RecordKind | null>(null)`; a `step` derived from kind + filled fields (compute the next incomplete step rather than storing it — back navigation pops the furthest field). Amount stored as a display string; converted with a `toMinor(display, currency)` helper (USD ×100, LBP ×1; reject >2 decimals for USD). Reset all state when `open` flips true→false→true (`useEffect` on `open`). Effective date defaults to today (`new Date().toISOString().slice(0, 10)`), editable on the details step. Keypad markup uses `.cr-keypad` (`direction: ltr` already in CSS).

- [ ] **Step 3: Wire in routes.tsx.** Props come from the hooks held by `ControlRoomRoutes`:

```tsx
<RecordSheet
  open={props.recordOpen}
  locale={props.locale}
  wallets={wallets.wallets}
  loans={outstandingLoans}        // derived from the loans hook
  payees={wallets.payees.map((p) => p.name)}  // check Payee shape in wallets/types.ts
  categoryTree={categoryTree}     // from useCategories: both kinds, roots + subcategories
  pending={wallets.pending || exchange.pending}
  error={sheetError}
  onClose={props.onCloseRecord}
  onSubmitRecord={async (draft) => { const r = await wallets.recordEvent(draft); if (r.status !== 'ambiguous') props.onCloseRecord(); }}
  onSubmitExchange={async (draft) => { const r = await exchange.recordExchange(draft); if (r.status === 'success') { await wallets.refresh(); props.onCloseRecord(); } }}
  onSubmitLoan={async (draft) => { await loans.createLoan({ mode: 'cash', ...draft }); props.onCloseRecord(); }}
  onSubmitRepayment={async (draft) => { await loans.recordRepayment(draft); props.onCloseRecord(); }}
/>
```

Check the exact `useLoans` return and draft field names in `src/features/loans/use-loans.ts` and match them. When `wallets.ambiguous` / `exchange.ambiguous` is set, render the `AmbiguousBanner` inside the sheet instead of closing.

- [ ] **Step 4: Tests green; commit** `"feat(control-room): stepped record sheet covering all seven posting flows"`.

---

## Task 10: Plan screen

**Files:**
- Create: `src/features/plan/plan-page.tsx`
- Test: `src/features/plan/plan-page.test.tsx`

- [ ] **Step 1: Failing tests:**
  1. Renders per-currency income card ("Planned income" / «الدخل المخطط») with the latest planned amount and an Edit button.
  2. Left-to-allocate shows `unallocatedMinor` formatted; when `overallocatedMinor` is non-zero it shows the overallocated amount with `cr-danger-text` instead.
  3. Category rows show name (locale-picked), target vs actual, and a `cr-progress` bar; rows with `overspentMinor !== '0'` get `cr-progress--over`.
  4. Editing income opens a dialog with amount keypad-less numeric input; saving calls `onSaveIncome({ currency, amountMinor, expectedRevisionId: summary.incomePlanRevisionId })`.
  5. Editing a category target passes that row's `targetRevisionId` as `expectedRevisionId`.
  6. On save returning false (conflict), an inline message "The plan changed elsewhere — refreshed, please review" / «تغيّرت الخطة من مكان آخر — تم التحديث، يرجى المراجعة» appears.

- [ ] **Step 2: Implement** `plan-page.tsx` as a pure component:

```tsx
export interface PlanPageProps {
  locale: Locale;
  month: string;
  summaries: readonly BudgetCurrencySummary[];
  categoryRows: readonly BudgetCategoryRow[];
  pending: boolean;
  error: string | null;
  onSaveIncome(input: { currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
  onSaveTarget(input: { categoryId: string; currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
}
```

Sections: (1) income cards (one per currency present in `summaries`; missing currency → "Set planned income" empty card), (2) left-to-allocate card per currency: `unallocated` vs `overallocated`, (3) category targets list (expense rows from `categoryRows`, active only — `archivedAt === null`), (4) loan commitments summary passed in from the loans hook (add `loansSummary: readonly CurrencySummary[]` prop — check the type name in `src/features/loans/types.ts`; render commitment per currency with a link-style button that switches the shell destination is NOT needed — loan target editing stays on the Manage → Loans screen). Edit dialog: `.cr-sheet` with one numeric input + save/cancel; pass `expectedRevisionId` from the loaded row (optimistic concurrency).

- [ ] **Step 3: Wire in routes.tsx** — `plan` destination renders `<PlanPage {...plan} onSaveIncome={plan.setIncomePlan} onSaveTarget={plan.setCategoryTarget} month={month} />`.

- [ ] **Step 4: Tests green; commit** `"feat(plan): monthly budget plan screen"`.

---

## Task 11: Manage screen

**Files:**
- Create: `src/features/control-room/manage-screen.tsx`
- Test: `src/features/control-room/manage-screen.test.tsx`

Manage composes EXISTING feature pages as sub-sections rather than rebuilding them. Read each existing page's props before wiring: `src/features/wallets/wallets-page.tsx`, `src/features/categories/categories-page.tsx` (or similarly named), `src/features/loans/loans-page.tsx`, `src/features/household/household-page.tsx`.

- [ ] **Step 1: Failing test.** Renders a section list: Wallets, Categories, Loans, Household (household only when `spaceKind === 'household'`), Language, Account. Selecting a section swaps the panel (local `useState<ManageSection>`). Language row shows the current locale and calls `onLocaleChange`. Account row shows `userEmail` and a Sign out button calling `onSignOut`.

- [ ] **Step 2: Implement.** `ManageSection = 'wallets' | 'categories' | 'loans' | 'household' | null` (null → section menu). The section menu is a `.cr-card` list of full-width `.cr-button` rows with chevrons. Sections render the existing page components inside `<div className="cr-main--wide">`. Reuse the existing page props; the wallets section gets the full `WalletsState` (so rename/archive/restore UI already present in the existing page, if any, keeps working — if the existing wallets page lacks lifecycle UI, do NOT add it here; that is a separate milestone).

- [ ] **Step 3: Wire in routes.tsx** — pass through `householdGateway`, `spaceKind`, `userEmail`, `onLocaleChange`, `onSignOut`.

- [ ] **Step 4: Tests green; commit** `"feat(control-room): manage screen composing existing feature pages"`.

---

## Task 12: Arabic/RTL pass

- [ ] **Step 1:** Grep all new files for `t(locale,` calls and confirm every user-facing string has an Arabic counterpart; add missing ones.
- [ ] **Step 2:** Add a test per new screen: render with `locale="ar"`, assert a key Arabic string is present and no raw English labels leak (spot-check buttons/headings).
- [ ] **Step 3:** Manual/Playwright check in Task 13 covers visual RTL. `pnpm test:ui` green; commit `"feat(control-room): complete Arabic copy for new screens"`.

---

## Task 13: Playwright e2e for the new shell

**Files:**
- Modify: `e2e/workspace-navigation.ts`
- Modify: `e2e/fixtures/application.ts` (and/or `e2e/fixtures/wallets.ts`) — add RPC mocks
- Create: `e2e/control-room.visual.spec.ts`

- [ ] **Step 1: Fixtures.** In the route-interception fixture, add handlers for: `monthly_budget_currency_summary` (return `[]`), `monthly_budget_category_page` (return `[]`), `report_wallet_activity` (return `[]`), `report_category_actual_vs_budget` (return `[]`), `record_usd_to_lbp_exchange` (return `[{ id: crypto.randomUUID() }]`). Follow the existing RPC-mock idiom in `e2e/fixtures/loans.ts`. Add fixture options mirroring existing ones: `planSummary` rows, `budgetRows`, `activityRows` for non-empty states.

- [ ] **Step 2: Navigation helpers.** Rewrite `openWorkspaceNavigation`/`chooseWorkspaceDestination`: the tab bar is always visible on mobile (no drawer); desktop uses the rail. `chooseWorkspaceDestination(page, name)` = click `role=button[name]` inside `nav`. Keep exported names so existing specs keep compiling; delete specs that no longer apply in Step 4.

- [ ] **Step 3: New spec** `e2e/control-room.visual.spec.ts`, both projects (desktop 1440×1000, mobile Pixel 7) via the existing `screenshotPath` helper:
  - Home with seeded budgets + activity + loans → screenshot.
  - Journal feed + entry detail sheet → screenshot.
  - Record sheet: type grid, amount step, confirm step → 3 screenshots.
  - Plan screen with over-budget category → screenshot.
  - Manage menu → screenshot.
  - Arabic RTL: `switchWorkspaceLanguage(page)` then Home + Record type grid → screenshots.
  - Containment: reuse `expectContainedControls(page)` on each screen.

- [ ] **Step 4:** Delete or rewrite old visual specs that target the removed shell (`e2e/application.visual.spec.ts` nav cases). Keep specs covering reused feature pages (categories/loans/household/wallets) but update their navigation to go through the new tab bar + Manage.

- [ ] **Step 5:** Run `pnpm test:e2e`. Generate artifacts with `UPDATE_VISUAL_ARTIFACTS=1 pnpm test:e2e` for review. Commit `"test(e2e): control room visual specs"`.

---

## Task 14: Cleanup + full verification

- [ ] **Step 1:** Delete `src/features/home/` and the old `src/features/shell/application-shell.tsx` + `workspace-navigation.tsx` ONLY if nothing imports them (`grep -r` first). Remove now-unreferenced legacy CSS classes from `src/styles.css` only when their last consumer is gone; when in doubt, leave the CSS.
- [ ] **Step 2:** `pnpm check:ui` (typecheck + unit + build) — green.
- [ ] **Step 3:** `pnpm test:db` — must be untouched and green.
- [ ] **Step 4:** `pnpm check:uat:scope` — must pass. If it fails, a protected file was edited: revert that edit and move the change into a new file.
- [ ] **Step 5:** Final commit `"chore: remove legacy shell screens replaced by control room"`.

---

## Verification matrix (run at the end)

| Command | Expected |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test:ui` | all green |
| `pnpm build` | succeeds |
| `pnpm test:db` | unchanged, green |
| `pnpm test:e2e` | green incl. new visual specs |
| `pnpm check:uat:scope` | passes |

## Handoff notes for the executing model

- Work top to bottom; each task ends in a commit. Do not skip `check:uat:scope`.
- When a plan code block references an existing symbol (`useWallets` return fields, `JournalEvent` fields, `useLoans` draft shapes, enum values), open the cited file and match the real signature — do not guess. The SQL signatures quoted in Tasks 1/3/4 are authoritative (copied from the migrations).
- Money signs: verify income/expense/transfer movement sign conventions against `tests/db/` wallet journal tests before finalizing Task 9.
- Keep PRs/commits small; never edit `supabase/`, `tests/db/`, `src/features/auth/`, or any `supabase-*-gateway.ts`.
