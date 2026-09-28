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

export interface LoadTemplateHeadInput {
  readonly spaceId: string;
  readonly currency: Currency;
}

/** The space's current template revision for this currency (`null` before any
 * template has ever been saved) -- the concurrency head `saveTemplate` must be
 * checked against, independent of any particular month's snapshot (audit B1:
 * a new month's snapshot always starts with a null `templateRevisionId`, which
 * is never the same thing as "no template exists yet"). */
export interface TemplateHeadResult {
  readonly templateRevisionId: string | null;
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

export interface AllocationGoalTargetInput {
  readonly goalId: string;
  readonly groupId: string | null;
  readonly amountMinor: string;
  readonly expectedRevisionId: string | null;
}

/** `publish_allocation_month_v2`'s own input -- a distinct command from
 * `publishMonth`, never an overload chosen ambiguously by argument shape,
 * per task 11/12's explicit instruction. */
export interface PublishMonthV2Input {
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
  readonly goalTargets: readonly AllocationGoalTargetInput[];
}

export interface PlanningCommandReceipt {
  readonly command: string;
  readonly sequenceId: string;
  readonly result: unknown;
}

// ---------------------------------------------------------------------------
// Month transitions (task 21): copy a saved month, close a month, and opt in
// per root/currency to signed carry. Field lists mirror
// `20260916100000_month_transitions.sql` exactly -- never inferred.
// ---------------------------------------------------------------------------

/** One row of `preview_month_copy`'s `roots[]`. `actualMinor`/
 * `outgoingCarryMinor` are close-only and are always `null` in a copy preview. */
export interface MonthCopyRootRow {
  readonly categoryId: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly groupId: string | null;
  readonly baseMinor: string;
  /** Signed integer text: an overspent root carries a negative amount. */
  readonly carryMinor: string;
  readonly effectiveMinor: string;
  readonly actualMinor: string | null;
  readonly outgoingCarryMinor: string | null;
  readonly expectedRevisionId: string | null;
}

export interface MonthCopyGroupRow {
  readonly groupId: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly purpose: AllocationGroupPurpose;
  readonly order: number;
  readonly basisPoints: number;
  readonly targetMinor: string;
  readonly carryMinor: string;
  readonly effectiveMinor: string;
}

export interface MonthCopyGoalRow {
  readonly goalId: string;
  readonly groupId: string | null;
  readonly targetMinor: string;
  readonly expectedRevisionId: string | null;
}

export type MonthCopyOmissionKind = 'root' | 'goal' | 'carry';
export interface MonthCopyOmission {
  readonly entityId: string;
  readonly kind: MonthCopyOmissionKind;
  readonly reason: string;
}

export interface MonthCopyCarrySource {
  readonly rootId: string;
  readonly sourceCloseId: string | null;
  readonly carryMinor: string;
}

/** `preview_month_copy` result. `carryMinor` is signed and is a distinct
 * adjustment, never income; the accepted `previewHash` (with
 * `expectedTargetSnapshotId`) is the exact acknowledgement `copy` replays. */
export interface MonthCopyPreview {
  readonly previewHash: string;
  readonly sourceSnapshotId: string;
  readonly sourceMonth: string;
  readonly targetMonth: string;
  readonly currency: Currency;
  readonly expectedTargetSnapshotId: string | null;
  readonly templateRevisionId: string;
  readonly expectedIncomeRevisionId: string | null;
  readonly incomeMinor: string;
  readonly loanGroupId: string | null;
  readonly carryCloseId: string | null;
  readonly roots: readonly MonthCopyRootRow[];
  readonly groups: readonly MonthCopyGroupRow[];
  readonly goals: readonly MonthCopyGoalRow[];
  readonly omissions: readonly MonthCopyOmission[];
  readonly carrySources: readonly MonthCopyCarrySource[];
}

export interface PreviewCopyInput {
  readonly spaceId: string;
  readonly currency: Currency;
  readonly sourceSnapshotId: string;
  readonly targetMonth: string;
}

export interface CopyMonthInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly currency: Currency;
  readonly sourceSnapshotId: string;
  readonly targetMonth: string;
  readonly expectedTargetSnapshotId: string | null;
  readonly acceptedPreviewHash: string;
}

export interface CopyMonthResult {
  readonly snapshotId: string;
  readonly sourceSnapshotId: string;
  readonly previewHash: string;
}

/** One row of `preview_budget_month_close`'s `roots[]`. `policyRevisionId` is
 * the root's current rollover-policy head (null before any opt-in), which is
 * also the exact head `setRollover` must be checked against. */
export interface CloseRootRow {
  readonly categoryId: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly groupId: string | null;
  readonly baseMinor: string;
  readonly carryMinor: string;
  readonly effectiveMinor: string;
  readonly actualMinor: string;
  /** Signed integer text and never clamped: an overspent enabled root carries
   * a negative amount into the next month. */
  readonly outgoingCarryMinor: string;
  readonly enabled: boolean;
  readonly policyRevisionId: string | null;
  readonly carrySourceCloseId: string | null;
}

export interface ClosePreview {
  readonly previewHash: string;
  readonly month: string;
  readonly currency: Currency;
  readonly snapshotId: string;
  /** The current close head this exact preview hash was computed against. */
  readonly expectedCloseId: string | null;
  readonly incomeMinor: string;
  readonly spendingMinor: string;
  readonly factCount: string;
  readonly factDigest: string;
  /** True when re-closing now would freeze a different set of facts -- the
   * freeze is restatement-aware, not silently reused. */
  readonly restatementRequired: boolean;
  readonly roots: readonly CloseRootRow[];
}

export interface PreviewCloseInput {
  readonly spaceId: string;
  readonly currency: Currency;
  readonly month: string;
  readonly expectedCloseId: string | null;
}

export interface CloseMonthInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly currency: Currency;
  readonly month: string;
  readonly expectedCloseId: string | null;
  readonly acceptedPreviewHash: string;
}

export interface CloseMonthResult {
  readonly closeId: string;
  readonly previewHash: string;
  /** The close this one supersedes (a restatement), or null for the first. */
  readonly restatesCloseId: string | null;
}

export interface SetRolloverInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly currency: Currency;
  readonly rootId: string;
  readonly enabled: boolean;
  readonly expectedRevisionId: string | null;
}

export interface SetRolloverResult {
  readonly revisionId: string;
}

export interface AllocationGateway {
  loadMonth(input: LoadMonthInput, signal?: AbortSignal): Promise<AllocationMonthState>;
  loadCategoryPage(input: LoadCategoryPageInput, signal?: AbortSignal): Promise<AllocationCategoryPage>;
  loadHistoryPage(input: LoadHistoryPageInput, signal?: AbortSignal): Promise<AllocationHistoryPage>;
  loadTrend(input: LoadTrendInput, signal?: AbortSignal): Promise<AllocationTrend>;
  loadTemplateHead(input: LoadTemplateHeadInput, signal?: AbortSignal): Promise<TemplateHeadResult>;
  saveTemplate(input: SaveTemplateInput): Promise<SaveTemplateResult>;
  publishMonth(input: PublishMonthInput): Promise<PublishMonthResult>;
  publishMonthV2(input: PublishMonthV2Input): Promise<PublishMonthResult>;
  findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null>;
  /** Copy a saved month: read-only preview carrying the exact hash + expected
   * target head the command must echo back. */
  previewCopy(input: PreviewCopyInput, signal?: AbortSignal): Promise<MonthCopyPreview>;
  copyMonth(input: CopyMonthInput): Promise<CopyMonthResult>;
  previewClose(input: PreviewCloseInput, signal?: AbortSignal): Promise<ClosePreview>;
  closeMonth(input: CloseMonthInput): Promise<CloseMonthResult>;
  setRollover(input: SetRolloverInput): Promise<SetRolloverResult>;
}
