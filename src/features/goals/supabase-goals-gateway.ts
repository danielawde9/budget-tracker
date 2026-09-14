import { planningRpc, type PlanningRpcClient } from '../planning-shared/rpc.js';
import {
  array, bigIntId, boolean, currency, date, enumValue, head, integer, minor, month,
  nullableMinor, nullableString, object, planningMoneyInput, string, uniqueBy, uuid,
} from '../planning-shared/parse.js';
import type {
  CreateGoalInput,
  CreateGoalResult,
  ExpectedGoalHead,
  GoalDefinitionInput,
  GoalDetail,
  GoalHistoryPage,
  GoalHistoryRow,
  GoalHistorySourceKind,
  GoalMilestoneInput,
  GoalMilestoneRow,
  GoalPage,
  GoalPurchaseLineInput,
  GoalSummary,
  GoalsGateway,
  LinkPurchaseInput,
  LinkPurchaseResult,
  LoadGoalDetailInput,
  LoadGoalHistoryInput,
  LoadGoalPageInput,
  MoveEarmarkInput,
  MoveEarmarkResult,
  PlanningCommandReceipt,
  ReserveOrReleaseInput,
  ReserveOrReleaseResult,
  ReverseEarmarkInput,
  ReverseEarmarkResult,
  ReviseGoalInput,
  ReviseGoalResult,
  SetMilestoneInput,
  SetMilestoneResult,
  SetMonthlyTargetInput,
  SetMonthlyTargetResult,
} from './types.js';

export type GoalsDataClient = PlanningRpcClient;

const GOAL_KINDS = ['reserve', 'purchase'] as const;
const GOAL_STATES = ['active', 'paused', 'closed'] as const;
const CONTRIBUTION_MODES = ['manual_monthly', 'by_deadline'] as const;
const MILESTONE_KINDS = ['amount', 'checklist'] as const;
const MILESTONE_STATES = ['complete', 'incomplete'] as const;
const HORIZONS = ['short', 'long', 'open'] as const;
const FORECAST_STATES = ['estimate', 'insufficient_history', 'no_positive_pace', 'beyond_horizon'] as const;
const HISTORY_SOURCE_KINDS: readonly GoalHistorySourceKind[] =
  ['definition', 'earmark', 'purchase_link', 'checklist', 'monthly_target', 'financial_reversal'];

const MAX_MILESTONES = 20;
const MAX_PAGE_ROWS = 100;
const MAX_HISTORY_ROWS = 100;
const MAX_EXPECTED_HEADS = 2;
const MAX_PURCHASE_LINES = 20;

/** Converts a bigint-identifier string into the JS number RPC callers use for
 * a `bigint` SQL parameter, matching the existing Plan/Allocation gateways'
 * convention. */
function bigIntArg(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]{0,14})$/.test(value)) throw new Error(`Invalid ${field}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} is too large to send safely.`);
  return parsed;
}

function nullableBigIntArg(value: string | null, field: string): number | null {
  if (value === null) return null;
  return bigIntArg(value, field);
}

function timestamp(value: unknown, field: string): string {
  const result = string(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`Invalid timestamp for ${field}.`);
  return result;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return timestamp(value, field);
}

/** Both cursor fields must be present or both absent -- a partial cursor is
 * rejected client-side too, mirroring the SQL's own guard. */
function requireCompleteCursor(fields: readonly (string | null)[], field: string): void {
  const presentCount = fields.filter((value) => value !== null).length;
  if (presentCount !== 0 && presentCount !== fields.length) {
    throw new Error(`Incomplete ${field} cursor.`);
  }
}

function milestoneRow(value: unknown): GoalMilestoneRow {
  const row = object(value);
  return {
    id: uuid(row['id'], 'milestone.id'),
    kind: enumValue(row['kind'], MILESTONE_KINDS, 'milestone.kind'),
    labelEn: nullableString(row['labelEn'], 'milestone.labelEn'),
    labelAr: nullableString(row['labelAr'], 'milestone.labelAr'),
    thresholdMinor: nullableMinor(row['thresholdMinor']),
    dueDate: row['dueDate'] === null || row['dueDate'] === undefined ? null : date(row['dueDate']),
    ordinal: integer(row['ordinal'], 'milestone.ordinal'),
    currentState: enumValue(row['currentState'], MILESTONE_STATES, 'milestone.currentState'),
  };
}

function parseMilestones(value: unknown): readonly GoalMilestoneRow[] {
  return uniqueBy(array(value, 'milestones', MAX_MILESTONES).map(milestoneRow), (item) => item.id, 'milestone.id');
}

function summaryRow(value: unknown): GoalSummary {
  const row = object(value);
  return {
    id: uuid(row['id'], 'id'),
    revisionId: bigIntId(row['revisionId'], 'revisionId'),
    currency: currency(row['currency']),
    kind: enumValue(row['kind'], GOAL_KINDS, 'kind'),
    state: enumValue(row['state'], GOAL_STATES, 'state'),
    nameEn: nullableString(row['nameEn'], 'nameEn'),
    nameAr: nullableString(row['nameAr'], 'nameAr'),
    targetMinor: minor(row['targetMinor']),
    earmarkedMinor: minor(row['earmarkedMinor']),
    coveredMinor: nullableMinor(row['coveredMinor']),
    fulfilledMinor: minor(row['fulfilledMinor']),
    shortageMinor: nullableMinor(row['shortageMinor']),
    monthlyTargetMinor: nullableMinor(row['monthlyTargetMinor']),
    monthlyNetContributionMinor: minor(row['monthlyNetContributionMinor']),
    dueDate: row['dueDate'] === null || row['dueDate'] === undefined ? null : date(row['dueDate']),
    horizon: enumValue(row['horizon'], HORIZONS, 'horizon'),
    needsReview: boolean(row['needsReview'], 'needsReview'),
    suggestedMonthlyMinor: nullableMinor(row['suggestedMonthlyMinor']),
    forecastMonth: row['forecastMonth'] === null || row['forecastMonth'] === undefined ? null : date(row['forecastMonth']),
    forecastState: enumValue(row['forecastState'], FORECAST_STATES, 'forecastState'),
    asOf: string(row['asOf'], 'asOf'),
  };
}

function parseGoalPage(value: unknown): GoalPage {
  const row = object(value);
  const rows = uniqueBy(array(row['rows'], 'rows', MAX_PAGE_ROWS).map(summaryRow), (item) => item.id, 'id');
  const cursor = row['nextCursor'];
  return {
    rows,
    hasMore: boolean(row['hasMore'], 'hasMore'),
    nextCursor: cursor === null || cursor === undefined ? null : (() => {
      const cursorRow = object(cursor);
      return { createdAt: timestamp(cursorRow['createdAt'], 'nextCursor.createdAt'), id: uuid(cursorRow['id'], 'nextCursor.id') };
    })(),
    asOf: string(row['asOf'], 'asOf'),
  };
}

function parseGoalDetail(value: unknown): GoalDetail {
  const row = object(value);
  return {
    summary: summaryRow(row['summary']),
    milestones: parseMilestones(row['milestones']),
    earmarkHead: head(row['earmarkHead'], 'earmarkHead'),
    definitionHead: string(row['definitionHead'], 'definitionHead'),
    asOf: string(row['asOf'], 'asOf'),
  };
}

function historyRow(value: unknown): GoalHistoryRow {
  const row = object(value);
  return {
    createdAt: timestamp(row['createdAt'], 'history.createdAt'),
    sourceKind: enumValue(row['sourceKind'], HISTORY_SOURCE_KINDS, 'history.sourceKind'),
    sourceId: string(row['sourceId'], 'history.sourceId'),
    detail: object(row['detail']),
  };
}

function parseGoalHistoryPage(value: unknown): GoalHistoryPage {
  const row = object(value);
  const rows = array(row['rows'], 'rows', MAX_HISTORY_ROWS).map(historyRow);
  const cursor = row['nextCursor'];
  return {
    rows,
    hasMore: boolean(row['hasMore'], 'hasMore'),
    nextCursor: cursor === null || cursor === undefined ? null : (() => {
      const cursorRow = object(cursor);
      return {
        createdAt: timestamp(cursorRow['createdAt'], 'nextCursor.createdAt'),
        sourceKind: enumValue(cursorRow['sourceKind'], HISTORY_SOURCE_KINDS, 'nextCursor.sourceKind'),
        sourceId: string(cursorRow['sourceId'], 'nextCursor.sourceId'),
      };
    })(),
  };
}

function createGoalResult(value: unknown): CreateGoalResult {
  const row = object(value);
  return { goalId: uuid(row['goalId'], 'goalId'), revisionId: bigIntId(row['revisionId'], 'revisionId') };
}

function reviseGoalResult(value: unknown): ReviseGoalResult {
  const row = object(value);
  return { goalId: uuid(row['goalId'], 'goalId'), revisionId: bigIntId(row['revisionId'], 'revisionId') };
}

function reserveOrReleaseResult(value: unknown): ReserveOrReleaseResult {
  const row = object(value);
  return { eventId: bigIntId(row['eventId'], 'eventId'), goalId: uuid(row['goalId'], 'goalId') };
}

function moveResult(value: unknown): MoveEarmarkResult {
  const row = object(value);
  return { eventId: bigIntId(row['eventId'], 'eventId') };
}

function reverseResult(value: unknown): ReverseEarmarkResult {
  const row = object(value);
  return { eventId: bigIntId(row['eventId'], 'eventId') };
}

function linkPurchaseResult(value: unknown): LinkPurchaseResult {
  const row = object(value);
  return { linkIds: array(row['linkIds'], 'linkIds', MAX_PURCHASE_LINES).map((item, index) => uuid(item, `linkIds[${index}]`)) };
}

function setMonthlyTargetResult(value: unknown): SetMonthlyTargetResult {
  const row = object(value);
  return { revisionId: bigIntId(row['revisionId'], 'revisionId') };
}

function setMilestoneResult(value: unknown): SetMilestoneResult {
  const row = object(value);
  return { eventId: bigIntId(row['eventId'], 'eventId') };
}

function receiptResult(value: unknown): PlanningCommandReceipt | null {
  if (value === null || value === undefined) return null;
  const row = object(value);
  return {
    command: string(row['command'], 'command'),
    sequenceId: bigIntId(row['sequenceId'], 'sequenceId'),
    result: row['result'],
  };
}

function definitionArg(definition: GoalDefinitionInput): Record<string, unknown> {
  return {
    kind: definition.kind,
    currency: currency(definition.currency),
    nameEn: definition.nameEn,
    nameAr: definition.nameAr,
    note: definition.note,
    targetMinor: planningMoneyInput(definition.targetMinor),
    deadline: definition.deadline === null ? null : date(definition.deadline),
    contributionMode: enumValue(definition.contributionMode, CONTRIBUTION_MODES, 'definition.contributionMode'),
    monthlyAmountMinor: definition.monthlyAmountMinor === null ? null : planningMoneyInput(definition.monthlyAmountMinor),
    priority: integer(definition.priority, 'definition.priority'),
  };
}

function milestoneArg(milestone: GoalMilestoneInput): Record<string, unknown> {
  return {
    id: uuid(milestone.id, 'milestone.id'),
    kind: enumValue(milestone.kind, MILESTONE_KINDS, 'milestone.kind'),
    labelEn: milestone.labelEn,
    labelAr: milestone.labelAr,
    thresholdMinor: milestone.thresholdMinor === null ? null : planningMoneyInput(milestone.thresholdMinor),
    dueDate: milestone.dueDate === null ? null : date(milestone.dueDate),
    ordinal: integer(milestone.ordinal, 'milestone.ordinal'),
  };
}

function expectedHeadArg(entry: ExpectedGoalHead): Record<string, unknown> {
  return { goalId: uuid(entry.goalId, 'expectedHeads.goalId'), head: head(entry.head, 'expectedHeads.head') };
}

function purchaseLineArg(line: GoalPurchaseLineInput): Record<string, unknown> {
  return {
    goalId: uuid(line.goalId, 'lines.goalId'),
    amountMinor: planningMoneyInput(line.amountMinor),
    expectedHead: head(line.expectedHead, 'lines.expectedHead'),
  };
}

export function createSupabaseGoalsGateway(client: GoalsDataClient): GoalsGateway {
  return {
    async loadPage(input: LoadGoalPageInput, signal?: AbortSignal) {
      requireCompleteCursor([input.afterCreatedAt, input.afterId], 'goal page');
      const data = await planningRpc(client, 'goal_page', {
        p_space_id: input.spaceId,
        p_currency: currency(input.currency),
        p_state_filter: input.stateFilter,
        p_after_created_at: input.afterCreatedAt,
        p_after_id: input.afterId,
        p_limit: input.limit,
      }, signal);
      return parseGoalPage(data);
    },

    async loadDetail(input: LoadGoalDetailInput, signal?: AbortSignal) {
      const data = await planningRpc(client, 'goal_detail', {
        p_space_id: input.spaceId,
        p_goal_id: input.goalId,
        p_month: month(input.month),
      }, signal);
      return parseGoalDetail(data);
    },

    async loadHistory(input: LoadGoalHistoryInput, signal?: AbortSignal) {
      requireCompleteCursor([input.beforeCreatedAt, input.beforeSourceKind, input.beforeSourceId], 'goal history');
      const data = await planningRpc(client, 'goal_history_page', {
        p_space_id: input.spaceId,
        p_goal_id: input.goalId,
        p_before_created_at: input.beforeCreatedAt,
        p_before_source_kind: input.beforeSourceKind,
        p_before_source_id: input.beforeSourceId,
        p_limit: input.limit,
      }, signal);
      return parseGoalHistoryPage(data);
    },

    async create(input: CreateGoalInput): Promise<CreateGoalResult> {
      if (input.milestones.length > MAX_MILESTONES) throw new Error('Too many milestones.');
      const data = await planningRpc(client, 'create_goal_plan', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_goal_id: input.goalId,
        p_definition: definitionArg(input.definition),
        p_milestones: input.milestones.map(milestoneArg),
      });
      return createGoalResult(data);
    },

    async revise(input: ReviseGoalInput): Promise<ReviseGoalResult> {
      if (input.milestones.length > MAX_MILESTONES) throw new Error('Too many milestones.');
      const data = await planningRpc(client, 'revise_goal_plan', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_goal_id: input.goalId,
        p_expected_revision_id: bigIntArg(input.expectedRevisionId, 'expectedRevisionId'),
        p_definition: definitionArg(input.definition),
        p_milestones: input.milestones.map(milestoneArg),
        p_state: input.state,
      });
      return reviseGoalResult(data);
    },

    async reserveOrRelease(input: ReserveOrReleaseInput): Promise<ReserveOrReleaseResult> {
      const data = await planningRpc(client, 'record_goal_earmark', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_goal_id: input.goalId,
        p_action: input.action,
        p_amount_minor: planningMoneyInput(input.amountMinor),
        p_expected_head: head(input.expectedHead, 'expectedHead'),
        p_accept_underfunded: input.acceptUnderfunded,
      });
      return reserveOrReleaseResult(data);
    },

    async move(input: MoveEarmarkInput): Promise<MoveEarmarkResult> {
      const data = await planningRpc(client, 'move_goal_earmark', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_from_goal_id: input.fromGoalId,
        p_to_goal_id: input.toGoalId,
        p_amount_minor: planningMoneyInput(input.amountMinor),
        p_expected_from_head: head(input.expectedFromHead, 'expectedFromHead'),
        p_expected_to_head: head(input.expectedToHead, 'expectedToHead'),
        p_accept_underfunded: input.acceptUnderfunded,
      });
      return moveResult(data);
    },

    async reverse(input: ReverseEarmarkInput): Promise<ReverseEarmarkResult> {
      if (input.expectedHeads.length < 1 || input.expectedHeads.length > MAX_EXPECTED_HEADS) {
        throw new Error('Invalid expected head count.');
      }
      const data = await planningRpc(client, 'reverse_goal_earmark', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_event_id: bigIntArg(input.eventId, 'eventId'),
        p_expected_heads: input.expectedHeads.map(expectedHeadArg),
      });
      return reverseResult(data);
    },

    async linkPurchase(input: LinkPurchaseInput): Promise<LinkPurchaseResult> {
      if (input.lines.length < 1 || input.lines.length > MAX_PURCHASE_LINES) throw new Error('Invalid purchase line count.');
      const data = await planningRpc(client, 'link_goal_purchase', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_expense_event_id: input.expenseEventId,
        p_lines: input.lines.map(purchaseLineArg),
      });
      return linkPurchaseResult(data);
    },

    async setMonthlyTarget(input: SetMonthlyTargetInput): Promise<SetMonthlyTargetResult> {
      const data = await planningRpc(client, 'set_goal_monthly_target', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_goal_id: input.goalId,
        p_month: month(input.month),
        p_amount_minor: planningMoneyInput(input.amountMinor),
        p_expected_revision_id: nullableBigIntArg(input.expectedRevisionId, 'expectedRevisionId'),
      });
      return setMonthlyTargetResult(data);
    },

    async setMilestone(input: SetMilestoneInput): Promise<SetMilestoneResult> {
      const data = await planningRpc(client, 'set_goal_milestone_state', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_milestone_id: input.milestoneId,
        p_action: input.action,
        p_expected_event_id: nullableBigIntArg(input.expectedEventId, 'expectedEventId'),
      });
      return setMilestoneResult(data);
    },

    async findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null> {
      const data = await planningRpc(client, 'find_planning_command', { p_space_id: spaceId, p_request_id: requestId });
      return receiptResult(data);
    },
  };
}
