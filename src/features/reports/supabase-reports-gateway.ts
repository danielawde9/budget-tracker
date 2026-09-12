import type { Currency } from '../loans/types.js';
import type { MonthlyCashSummary, ReportsGateway, ReportPeriodRole } from './types.js';

interface DataError { message: string }
interface DataResult { data: unknown[] | null; error: DataError | null }
export interface ReportsDataClient { rpc(name: string, args: Record<string, unknown>): Promise<DataResult> }
type Row = Record<string, unknown>;

const currencies = new Set<Currency>(['USD', 'LBP']);
const periodRoles = new Set<ReportPeriodRole>(['previous', 'current']);
const monthPattern = /^\d{4}-\d{2}-01$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function row(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('The database returned an invalid report row.');
  return value as Row;
}
function text(value: Row, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') throw new Error(`The database row is missing ${key}.`);
  return result;
}
function minor(value: Row, key: string): string {
  const result = value[key];
  if (typeof result === 'string' && /^-?\d+$/.test(result)) return result;
  if (typeof result === 'number' && Number.isSafeInteger(result)) return String(result);
  throw new Error(`The database row has an unsafe ${key} money value.`);
}

export function createSupabaseReportsGateway(client: ReportsDataClient): ReportsGateway {
  return {
    async loadMonthlyComparison(spaceId, anchorMonth) {
      if (!uuidPattern.test(spaceId)) throw new Error('The report space is invalid.');
      if (!monthPattern.test(anchorMonth)) throw new Error('The report month must be normalized to its first day.');
      const result = await client.rpc('report_monthly_cash_summary', { p_space_id: spaceId, p_anchor_month: anchorMonth });
      if (result.error) throw result.error;
      const values = result.data ?? [];
      if (values.length !== 4) throw new Error('Monthly comparison must return exactly four currency-period rows.');
      const reports = values.map((value): MonthlyCashSummary => {
        const current = row(value);
        const periodMonth = text(current, 'period_month');
        const periodRole = text(current, 'period_role') as ReportPeriodRole;
        const currency = text(current, 'currency') as Currency;
        if (!monthPattern.test(periodMonth) || !periodRoles.has(periodRole) || !currencies.has(currency)) throw new Error('The database returned an invalid monthly comparison dimension.');
        return { periodMonth, periodRole, currency, incomeNetMinor: minor(current, 'income_net_minor'), expenseNetMinor: minor(current, 'expense_net_minor'), walletDeltaNetMinor: minor(current, 'wallet_delta_net_minor') };
      });
      const keys = new Set(reports.map((report) => `${report.periodRole}:${report.currency}`));
      if (keys.size !== 4 || !['previous:USD', 'current:USD', 'previous:LBP', 'current:LBP'].every((key) => keys.has(key))) throw new Error('Monthly comparison must contain each period and currency exactly once.');
      return reports;
    },
  };
}
