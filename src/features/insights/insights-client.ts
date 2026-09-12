import type { CategoryBudgetRow, InsightsClient, ReportEventKind, WalletActivityRow } from './types.js';
import type { Currency } from '../loans/types.js';

interface InsightsDataClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

const currencies = new Set<Currency>(['USD', 'LBP']);
const eventKinds = new Set<ReportEventKind>([
  'opening_balance',
  'income',
  'expense',
  'transfer',
  'reversal',
  'loan_opening',
  'loan_lend',
  'loan_borrow',
  'loan_receive_repayment',
  'loan_repay_borrowing',
  'exchange',
]);
const DEFAULT_EVENT_LIMIT = 50;

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

function booleanValue(value: Row, key: string): boolean {
  const result = value[key];
  if (typeof result !== 'boolean') throw new Error(`The database row has invalid ${key}.`);
  return result;
}

async function call(client: InsightsDataClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function eventKindValue(value: Row, key: string): ReportEventKind {
  const result = textValue(value, key) as ReportEventKind;
  if (!eventKinds.has(result)) throw new Error(`The database row has unsupported ${key}.`);
  return result;
}

function categoryKindValue(value: Row, key: string): 'income' | 'expense' {
  const result = textValue(value, key);
  if (result !== 'income' && result !== 'expense') throw new Error(`The database row has unsupported ${key}.`);
  return result;
}

function activityRow(row: unknown): WalletActivityRow {
  const r = asRow(row);
  return {
    eventId: textValue(r, 'event_id'),
    kind: eventKindValue(r, 'kind'),
    effectiveDate: textValue(r, 'effective_date'),
    createdAt: textValue(r, 'created_at'),
    reversalOf: nullableText(r, 'reversal_of'),
    walletId: textValue(r, 'wallet_id'),
    walletName: textValue(r, 'wallet_name'),
    currency: currencyValue(r, 'currency'),
    amountMinor: minorValue(r, 'amount_minor'),
    hasMore: booleanValue(r, 'has_more'),
  };
}

function budgetRow(row: unknown): CategoryBudgetRow {
  const r = asRow(row);
  return {
    categoryKey: textValue(r, 'category_key'),
    nameEn: nullableText(r, 'category_name_en'),
    nameAr: nullableText(r, 'category_name_ar'),
    kind: categoryKindValue(r, 'category_kind'),
    currency: currencyValue(r, 'currency'),
    actualNetMinor: minorValue(r, 'actual_net_minor'),
    budgetMinor: nullableMinorValue(r, 'budget_minor'),
    remainingMinor: nullableMinorValue(r, 'remaining_minor'),
  };
}

export function createInsightsClient(client: InsightsDataClient): InsightsClient {
  return {
    async walletActivity(input) {
      const data = await call(client, 'report_wallet_activity', {
        p_space_id: input.spaceId,
        p_from_date: input.fromDate,
        p_to_date: input.toDate,
        p_wallet_id: input.walletId ?? null,
        p_currency: input.currency ?? null,
        p_event_limit: input.limit ?? DEFAULT_EVENT_LIMIT,
      });
      if (!Array.isArray(data)) throw new Error('Unexpected wallet activity shape.');
      return (data as unknown[]).map(activityRow);
    },
    async categoryActualVsBudget(spaceId, month) {
      const data = await call(client, 'report_category_actual_vs_budget', { p_space_id: spaceId, p_month: month });
      if (!Array.isArray(data)) throw new Error('Unexpected category budget shape.');
      return (data as unknown[]).map(budgetRow);
    },
  };
}
