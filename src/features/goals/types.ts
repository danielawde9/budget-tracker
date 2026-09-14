import type { Currency } from '../loans/types.js';

export type GoalKind = 'reserve' | 'purchase';
export type GoalState = 'active' | 'paused' | 'closed';
export type GoalStateFilter = 'active' | 'paused' | 'closed' | 'all' | 'needs_review';
export type GoalContributionMode = 'manual_monthly' | 'by_deadline';
export type GoalMilestoneKind = 'amount' | 'checklist';
export type GoalMilestoneState = 'complete' | 'incomplete';
export type GoalHorizon = 'short' | 'long' | 'open';
export type GoalForecastState = 'estimate' | 'insufficient_history' | 'no_positive_pace' | 'beyond_horizon';
export type GoalEarmarkAction = 'reserve' | 'release';
export type GoalMilestoneAction = 'complete' | 'reopen';
export type GoalHistorySourceKind =
  | 'definition' | 'earmark' | 'purchase_link' | 'checklist' | 'monthly_target' | 'financial_reversal';

/** A definition/milestones snapshot, exactly as `create_goal_plan`/
 * `revise_goal_plan` accept it (task 10's own exact key lists) -- never an
 * invitation to add a field the DB contract doesn't declare. */
export interface GoalDefinitionInput {
  readonly kind: GoalKind;
  readonly currency: Currency;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly note: string | null;
  readonly targetMinor: string;
  readonly deadline: string | null;
  readonly contributionMode: GoalContributionMode;
  readonly monthlyAmountMinor: string | null;
  readonly priority: number;
}

export interface GoalMilestoneInput {
  readonly id: string;
  readonly kind: GoalMilestoneKind;
  readonly labelEn: string | null;
  readonly labelAr: string | null;
  readonly thresholdMinor: string | null;
  readonly dueDate: string | null;
  readonly ordinal: number;
}

export interface GoalMilestoneRow {
  readonly id: string;
  readonly kind: GoalMilestoneKind;
  readonly labelEn: string | null;
  readonly labelAr: string | null;
  readonly thresholdMinor: string | null;
  readonly dueDate: string | null;
  readonly ordinal: number;
  readonly currentState: GoalMilestoneState;
}

/** One `goal_page` row or `goal_detail`'s `summary` -- the exact shared
 * shape task 11 declares. `coveredMinor`/`shortageMinor` are nullable only
 * when coverage is unavailable; a goal with unknown coverage is never
 * silently treated as zero. */
export interface GoalSummary {
  readonly id: string;
  readonly revisionId: string;
  readonly currency: Currency;
  readonly kind: GoalKind;
  readonly state: GoalState;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly targetMinor: string;
  readonly earmarkedMinor: string;
  readonly coveredMinor: string | null;
  readonly fulfilledMinor: string;
  readonly shortageMinor: string | null;
  readonly monthlyTargetMinor: string | null;
  readonly monthlyNetContributionMinor: string;
  readonly dueDate: string | null;
  readonly horizon: GoalHorizon;
  readonly needsReview: boolean;
  readonly suggestedMonthlyMinor: string | null;
  readonly forecastMonth: string | null;
  readonly forecastState: GoalForecastState;
  readonly asOf: string;
}

export interface GoalPageCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface GoalPage {
  readonly rows: readonly GoalSummary[];
  readonly hasMore: boolean;
  readonly nextCursor: GoalPageCursor | null;
  readonly asOf: string;
}

export interface GoalDetail {
  readonly summary: GoalSummary;
  readonly milestones: readonly GoalMilestoneRow[];
  readonly earmarkHead: string;
  readonly definitionHead: string;
  readonly asOf: string;
}

export interface GoalHistoryCursor {
  readonly createdAt: string;
  readonly sourceKind: GoalHistorySourceKind;
  readonly sourceId: string;
}

export interface GoalHistoryRow {
  readonly createdAt: string;
  readonly sourceKind: GoalHistorySourceKind;
  readonly sourceId: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface GoalHistoryPage {
  readonly rows: readonly GoalHistoryRow[];
  readonly hasMore: boolean;
  readonly nextCursor: GoalHistoryCursor | null;
}

export interface LoadGoalPageInput {
  readonly spaceId: string;
  readonly currency: Currency;
  readonly stateFilter: GoalStateFilter;
  readonly afterCreatedAt: string | null;
  readonly afterId: string | null;
  readonly limit: number;
}

export interface LoadGoalDetailInput {
  readonly spaceId: string;
  readonly goalId: string;
  readonly month: string;
}

export interface LoadGoalHistoryInput {
  readonly spaceId: string;
  readonly goalId: string;
  readonly beforeCreatedAt: string | null;
  readonly beforeSourceKind: GoalHistorySourceKind | null;
  readonly beforeSourceId: string | null;
  readonly limit: number;
}

export interface CreateGoalInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly goalId: string;
  readonly definition: GoalDefinitionInput;
  readonly milestones: readonly GoalMilestoneInput[];
}

export interface CreateGoalResult {
  readonly goalId: string;
  readonly revisionId: string;
}

export interface ReviseGoalInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly goalId: string;
  readonly expectedRevisionId: string;
  readonly definition: GoalDefinitionInput;
  readonly milestones: readonly GoalMilestoneInput[];
  readonly state: GoalState;
}

export interface ReviseGoalResult {
  readonly goalId: string;
  readonly revisionId: string;
}

export interface ReserveOrReleaseInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly goalId: string;
  readonly action: GoalEarmarkAction;
  readonly amountMinor: string;
  readonly expectedHead: string;
  readonly acceptUnderfunded: boolean;
}

export interface ReserveOrReleaseResult {
  readonly eventId: string;
  readonly goalId: string;
}

export interface MoveEarmarkInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly fromGoalId: string;
  readonly toGoalId: string;
  readonly amountMinor: string;
  readonly expectedFromHead: string;
  readonly expectedToHead: string;
  readonly acceptUnderfunded: boolean;
}

export interface MoveEarmarkResult {
  readonly eventId: string;
}

export interface ExpectedGoalHead {
  readonly goalId: string;
  readonly head: string;
}

export interface ReverseEarmarkInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly eventId: string;
  readonly expectedHeads: readonly ExpectedGoalHead[];
}

export interface ReverseEarmarkResult {
  readonly eventId: string;
}

export interface GoalPurchaseLineInput {
  readonly goalId: string;
  readonly amountMinor: string;
  readonly expectedHead: string;
}

export interface LinkPurchaseInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly expenseEventId: string;
  readonly lines: readonly GoalPurchaseLineInput[];
}

export interface LinkPurchaseResult {
  readonly linkIds: readonly string[];
}

export interface SetMonthlyTargetInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly goalId: string;
  readonly month: string;
  readonly amountMinor: string;
  readonly expectedRevisionId: string | null;
}

export interface SetMonthlyTargetResult {
  readonly revisionId: string;
}

export interface SetMilestoneInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly milestoneId: string;
  readonly action: GoalMilestoneAction;
  readonly expectedEventId: string | null;
}

export interface SetMilestoneResult {
  readonly eventId: string;
}

export interface PlanningCommandReceipt {
  readonly command: string;
  readonly sequenceId: string;
  readonly result: unknown;
}

export interface GoalsGateway {
  loadPage(input: LoadGoalPageInput, signal?: AbortSignal): Promise<GoalPage>;
  loadDetail(input: LoadGoalDetailInput, signal?: AbortSignal): Promise<GoalDetail>;
  loadHistory(input: LoadGoalHistoryInput, signal?: AbortSignal): Promise<GoalHistoryPage>;
  create(input: CreateGoalInput): Promise<CreateGoalResult>;
  revise(input: ReviseGoalInput): Promise<ReviseGoalResult>;
  reserveOrRelease(input: ReserveOrReleaseInput): Promise<ReserveOrReleaseResult>;
  move(input: MoveEarmarkInput): Promise<MoveEarmarkResult>;
  reverse(input: ReverseEarmarkInput): Promise<ReverseEarmarkResult>;
  linkPurchase(input: LinkPurchaseInput): Promise<LinkPurchaseResult>;
  setMonthlyTarget(input: SetMonthlyTargetInput): Promise<SetMonthlyTargetResult>;
  setMilestone(input: SetMilestoneInput): Promise<SetMilestoneResult>;
  findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null>;
}
