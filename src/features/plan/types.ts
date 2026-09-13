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
