import type {
  BudgetCategoryRow,
  BudgetCurrencySummary,
  PlanClient,
  SetCategoryTargetInput,
  SetIncomePlanInput,
} from './types.js';
import type { Currency } from '../loans/types.js';

interface PlanDataClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

const currencies = new Set<Currency>(['USD', 'LBP']);
const V3_PAGE_LIMIT = 100;
const MAX_CATEGORY_PAGES = 20;

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

function categoryRowV3(row: unknown, currency: Currency): BudgetCategoryRow {
  const r = asRow(row);
  const nameEn = nullableText(r, 'name_en');
  const nameAr = nullableText(r, 'name_ar');
  if (nameEn === null && nameAr === null) throw new Error('The database row has no display name.');
  return {
    categoryId: textValue(r, 'category_id'),
    nameEn,
    nameAr,
    archivedAt: nullableText(r, 'archived_at'),
    currency,
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
    async loadCategoryRows(spaceId, month, currency) {
      const rows: BudgetCategoryRow[] = [];
      let after: { createdAt: string; categoryId: string } | null = null;
      for (let pageIndex = 0; pageIndex < MAX_CATEGORY_PAGES; pageIndex += 1) {
        const data = await call(client, 'monthly_budget_category_page_v3', {
          p_space_id: spaceId,
          p_month: month,
          p_currency: currency,
          p_after_created_at: after?.createdAt ?? null,
          p_after_category_id: after?.categoryId ?? null,
          p_limit: V3_PAGE_LIMIT,
        });
        if (!Array.isArray(data)) throw new Error('Unexpected category page shape.');
        const page = (data as unknown[]).map((value) => categoryRowV3(value, currency));
        rows.push(...page);
        const last = (data as unknown[]).at(-1);
        const hasMore = last !== undefined && asRow(last)['has_more'] === true;
        if (!hasMore) return rows;
        after = { createdAt: textValue(asRow(last), 'category_created_at'), categoryId: textValue(asRow(last), 'category_id') };
      }
      throw new Error('Too many categories to plan at once.');
    },
    setIncomePlan(input) {
      return postPlan(client, 'set_monthly_income_plan', input);
    },
    setCategoryTarget(input) {
      return postPlan(client, 'set_monthly_category_target', input);
    },
  };
}
