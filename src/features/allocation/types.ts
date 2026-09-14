import type { Currency } from '../loans/types.js';

export type AllocationGroupPurpose = 'spending' | 'future';
export type AllocationRowKind = AllocationGroupPurpose | 'unmapped' | 'uncategorized';

/** One row of `allocation_month_state`'s `groups[]`. Real rows (spending/future)
 * carry `groupId`; the two synthetic rows (unmapped/uncategorized) always have
 * `groupId: null` and are identified by `rowKind` instead. */
export interface AllocationGroupRow {
  readonly groupId: string | null;
  readonly rowKind: AllocationRowKind;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly order: number | null;
  readonly targetMinor: string | null;
  readonly actualMinor: string;
  readonly varianceMinor: string | null;
  readonly basisPoints: number | null;
  /** Signed integer text, never a number -- the ratio is unbounded when income is tiny. */
  readonly actualShareOfIncomeBps: string | null;
  readonly hasPlan: boolean;
}

export interface AllocationMonthState {
  readonly snapshotId: string | null;
  readonly templateRevisionId: string | null;
  readonly incomeRevisionId: string | null;
  readonly hasPlan: boolean;
  readonly plannedIncomeMinor: string | null;
  readonly actualIncomeMinor: string;
  readonly expenseMinor: string;
  readonly incomeAfterSpendingMinor: string;
  readonly ownDebtPaidMinor: string;
  readonly remainingDebtMinor: string;
  readonly leftToAllocateMinor: string | null;
  readonly childPlanChanged: boolean;
  readonly asOf: string;
  readonly groups: readonly AllocationGroupRow[];
}

export interface AllocationCategoryRow {
  readonly rootId: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly targetMinor: string;
  readonly actualMinor: string;
  readonly varianceMinor: string;
  readonly hasPlan: boolean;
  readonly groupId: string | null;
}

export interface AllocationCategoryPage {
  readonly rows: readonly AllocationCategoryRow[];
  readonly nextRootId: string | null;
  readonly hasMore: boolean;
}

export interface AllocationHistoryRow {
  readonly snapshotId: string;
  readonly createdAt: string;
  readonly actorId: string;
  readonly plannedIncomeMinor: string;
  readonly templateRevisionId: string;
}

export interface AllocationHistoryPage {
  readonly rows: readonly AllocationHistoryRow[];
  readonly nextId: string | null;
  readonly hasMore: boolean;
}

export interface AllocationTrendMonth {
  readonly month: string;
  readonly incomeMinor: string;
  readonly expenseMinor: string;
  readonly ownDebtPaidMinor: string;
  readonly hasPlan: boolean;
  readonly plannedIncomeMinor: string | null;
}

export interface AllocationTrend {
  readonly months: readonly AllocationTrendMonth[];
}

export interface LoadMonthInput {
  readonly spaceId: string;
  readonly month: string;
  readonly currency: Currency;
  readonly snapshotId: string | null;
}

export interface LoadCategoryPageInput {
  readonly spaceId: string;
  readonly month: string;
  readonly currency: Currency;
  readonly snapshotId: string;
  readonly groupId: string | null;
  readonly afterRootId: string | null;
  readonly limit: number;
}

export interface LoadHistoryPageInput {
  readonly spaceId: string;
  readonly month: string;
  readonly currency: Currency;
  readonly beforeId: string | null;
  readonly limit: number;
}

export interface LoadTrendInput {
  readonly spaceId: string;
  readonly currency: Currency;
  readonly firstMonth: string;
  readonly monthCount: number;
}

/** Template group input. `basisPoints` is already-parsed integer bps (56.25% -> 5625);
 * the UI is responsible for the at-most-two-decimal-digit percent conversion. */
export interface AllocationTemplateGroupInput {
  readonly id: string;
  readonly purpose: AllocationGroupPurpose;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly order: number;
  readonly basisPoints: number;
}

export interface AllocationRootMappingInput {
  readonly categoryId: string;
  readonly groupId: string;
}

export interface SaveTemplateInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly currency: Currency;
  readonly expectedRevisionId: string | null;
  readonly groups: readonly AllocationTemplateGroupInput[];
  readonly rootMappings: readonly AllocationRootMappingInput[];
}

export interface SaveTemplateResult {
  readonly templateRevisionId: string;
}

export interface AllocationRootTargetInput {
  readonly categoryId: string;
  readonly amountMinor: string;
  readonly expectedRevisionId: string | null;
}

export interface PublishMonthInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly month: string;
  readonly currency: Currency;
  readonly expectedSnapshotId: string | null;
  readonly templateRevisionId: string;
  readonly expectedIncomeRevisionId: string | null;
  readonly incomeMinor: string;
  readonly rootTargets: readonly AllocationRootTargetInput[];
  readonly loanGroupId: string | null;
}

export interface PublishMonthResult {
  readonly snapshotId: string;
  readonly incomeRevisionId: string;
}

export interface PlanningCommandReceipt {
  readonly command: string;
  readonly sequenceId: string;
  readonly result: unknown;
}

export interface AllocationGateway {
  loadMonth(input: LoadMonthInput, signal?: AbortSignal): Promise<AllocationMonthState>;
  loadCategoryPage(input: LoadCategoryPageInput, signal?: AbortSignal): Promise<AllocationCategoryPage>;
  loadHistoryPage(input: LoadHistoryPageInput, signal?: AbortSignal): Promise<AllocationHistoryPage>;
  loadTrend(input: LoadTrendInput, signal?: AbortSignal): Promise<AllocationTrend>;
  saveTemplate(input: SaveTemplateInput): Promise<SaveTemplateResult>;
  publishMonth(input: PublishMonthInput): Promise<PublishMonthResult>;
  findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null>;
}
