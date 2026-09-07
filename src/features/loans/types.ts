export type Currency = 'USD' | 'LBP';
export type Locale = 'en' | 'ar';
export type LoanDirection = 'they_owe_me' | 'i_owe_them';
export type LoanStatus = 'outstanding' | 'settled' | 'overdue';
export type SpaceKind = 'personal' | 'household';

export interface Space {
  id: string;
  name: string;
  kind: SpaceKind;
}

export interface Wallet {
  id: string;
  spaceId: string;
  name: string;
  currency: Currency;
  archivedAt: string | null;
}

export interface LoanPlan {
  targetMinor: string;
  actualRepaymentMinor: string;
  remainingReservationMinor: string;
  dueAmountMinor: string;
  expectedCollectionMinor: string;
}

export interface LoanHistoryItem {
  eventId: string;
  kind: 'loan_opening' | 'loan_lend' | 'loan_borrow' | 'loan_receive_repayment' | 'loan_repay_borrowing' | 'reversal';
  effectiveDate: string;
  createdAt: string;
  principalDeltaMinor: string;
  repaymentEffectMinor: string;
  walletName: string | null;
  walletAmountMinor: string | null;
  reversalOf: string | null;
  reversedBy: string | null;
}

export interface Loan {
  id: string;
  spaceId: string;
  direction: LoanDirection;
  personName: string;
  currency: Currency;
  effectiveDate: string;
  dueDate: string | null;
  note: string | null;
  outstandingMinor: string;
  originalPrincipalMinor: string;
  totalRepaidMinor: string;
  status: LoanStatus;
  plan: LoanPlan;
  history?: readonly LoanHistoryItem[];
}

export interface CurrencySummary extends LoanPlan {
  currency: Currency;
  owedToMeMinor: string;
  iOweMinor: string;
}

export interface LoansDashboard {
  space: Space;
  month: string;
  wallets: readonly Wallet[];
  loans: readonly Loan[];
  summaries: readonly CurrencySummary[];
}

export type LoanErrorCode =
  | 'wrong_currency'
  | 'overpayment'
  | 'retry_collision'
  | 'missing_membership'
  | 'dependent_repayment'
  | 'database_rejection';

export interface LoanErrorView {
  code: LoanErrorCode;
  title: string;
  message: string;
  recovery: string;
}
