import type { Currency } from '../loans/types.js';

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
  nameEn: string | null;
  nameAr: string | null;
  archivedAt: string | null;
  currency: Currency;
  targetMinor: string | null;
  actualSpentMinor: string;
  remainingMinor: string | null;
  overspentMinor: string;
  targetRevisionId: string | null;
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
  loadCategoryRows(spaceId: string, month: string, currency: Currency): Promise<readonly BudgetCategoryRow[]>;
  setIncomePlan(input: SetIncomePlanInput): Promise<{ revisionId: string }>;
  setCategoryTarget(input: SetCategoryTargetInput): Promise<{ revisionId: string }>;
}
