import type { Currency } from '../loans/types.js';

export type ReportEventKind =
  | 'opening_balance'
  | 'income'
  | 'expense'
  | 'transfer'
  | 'reversal'
  | 'loan_opening'
  | 'loan_lend'
  | 'loan_borrow'
  | 'loan_receive_repayment'
  | 'loan_repay_borrowing'
  | 'exchange';

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
  nameEn: string | null;
  nameAr: string | null;
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
