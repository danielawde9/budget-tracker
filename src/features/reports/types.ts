import type { Currency } from '../loans/types.js';

export type ReportPeriodRole = 'previous' | 'current';

export interface MonthlyCashSummary {
  periodMonth: string;
  periodRole: ReportPeriodRole;
  currency: Currency;
  incomeNetMinor: string;
  expenseNetMinor: string;
  walletDeltaNetMinor: string;
}

export interface ReportsGateway {
  loadMonthlyComparison(spaceId: string, anchorMonth: string): Promise<readonly MonthlyCashSummary[]>;
}
