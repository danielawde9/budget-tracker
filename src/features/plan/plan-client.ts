import type {
  BudgetCategoryPage,
  BudgetCategoryRow,
  BudgetCurrencySummary,
  CategoryPageCursor,
  PlanClient,
  SetCategoryTargetInput,
  SetIncomePlanInput,
} from './types.js';
import type { Currency } from '../loans/types.js';

interface PlanDataClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

const currencies = new Set<Currency>(['USD', 'LBP']);
const PAGE_LIMIT = 50;

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The database returned an invalid row.');
  }
  return value as Row;
}

function textValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') throw new Error(`The database row is missing ${key}.`);
  return result;
}

function nullableText(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== 'string') throw new Error(`The database row has invalid ${key}.`);
  return result;
}

function currencyValue(value: Row, key: string): Currency {
  const result = textValue(value, key) as Currency;
  if (!currencies.has(result)) throw new Error(`The database row has unsupported ${key}.`);
  return result;
}

function minorValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result === 'string' && /^-?\d+$/.test(result)) return result;
  if (typeof result === 'number' && Number.isSafeInteger(result)) return String(result);
  throw new Error(`The database row has an unsafe ${key} money value.`);
}

function nullableMinorValue(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  return minorValue(value, key);
}

async function call(client: PlanDataClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function summaryRow(row: unknown): BudgetCurrencySummary {
  const r = asRow(row);
  return {
    currency: currencyValue(r, 'currency'),
    plannedIncomeMinor: minorValue(r, 'planned_income_minor'),
    actualIncomeMinor: minorValue(r, 'actual_income_minor'),
    categoryTargetTotalMinor: minorValue(r, 'category_target_total_minor'),
    categoryActualSpentMinor: minorValue(r, 'category_actual_spent_minor'),
    uncategorizedSpentMinor: minorValue(r, 'uncategorized_spent_minor'),
    categoryOverspentMinor: minorValue(r, 'category_overspent_minor'),
    actualLoanRepaymentMinor: minorValue(r, 'actual_loan_repayment_minor'),
    remainingLoanReservationMinor: minorValue(r, 'remaining_loan_reservation_minor'),
    loanCommitmentMinor: minorValue(r, 'loan_commitment_minor'),
    unallocatedMinor: minorValue(r, 'unallocated_minor'),
    overallocatedMinor: minorValue(r, 'overallocated_minor'),
    incomePlanRevisionId: nullableMinorValue(r, 'income_plan_revision_id'),
  };
}

function categoryRow(row: unknown): BudgetCategoryRow {
  const r = asRow(row);
  return {
    categoryId: textValue(r, 'category_id'),
    nameEn: textValue(r, 'name_en'),
    nameAr: textValue(r, 'name_ar'),
    archivedAt: nullableText(r, 'archived_at'),
    currency: currencyValue(r, 'currency'),
    targetMinor: nullableMinorValue(r, 'target_minor'),
    actualSpentMinor: minorValue(r, 'actual_spent_minor'),
    remainingMinor: nullableMinorValue(r, 'remaining_minor'),
    overspentMinor: minorValue(r, 'overspent_minor'),
    targetRevisionId: nullableMinorValue(r, 'target_revision_id'),
  };
}

function expectedRevisionArg(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!/^\d+$/.test(value)) throw new Error('The expected revision id is invalid.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('The expected revision id is invalid.');
  return parsed;
}

function revisionIdValue(row: Row, key: string): string {
  const result = row[key];
  if (typeof result === 'number' && Number.isSafeInteger(result)) return String(result);
  if (typeof result === 'string' && /^\d+$/.test(result)) return result;
  throw new Error('Unexpected revision id in plan response.');
}

async function postPlan(client: PlanDataClient, name: string, input: SetIncomePlanInput | SetCategoryTargetInput) {
  const base = {
    p_space_id: input.spaceId,
    p_request_id: input.requestId,
    p_month: input.month,
    p_currency: input.currency,
    p_amount_minor: input.amountMinor,
    p_expected_revision_id: expectedRevisionArg(input.expectedRevisionId),
  };
  const args = 'categoryId' in input ? { ...base, p_category_id: input.categoryId } : base;
  const data = await call(client, name, args);
  if (!Array.isArray(data) || data.length !== 1) throw new Error('Plan command returned an unexpected result.');
  return { revisionId: revisionIdValue(asRow(data[0]), 'id') };
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
