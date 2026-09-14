import { planningRpc, type PlanningRpcClient } from '../planning-shared/rpc.js';
import {
  array, bigIntId, boolean, currency, date, enumValue, integer, minor,
  nullableMinor, nullableUuid, object, planningMoneyInput, string, uniqueBy, uuid,
} from '../planning-shared/parse.js';
import type {
  ConfirmInput,
  ConfirmResult,
  LinkExistingInput,
  LinkExistingResult,
  LoadOccurrencesInput,
  MaterializeInput,
  MaterializeResult,
  OccurrenceState,
  PlanningCommandReceipt,
  RecurringGateway,
  SaveScheduleInput,
  SaveScheduleResult,
  ScheduleCadence,
  ScheduleDefinitionInput,
  ScheduledOccurrenceRow,
  ScheduledOccurrencePage,
  ScheduleKind,
  ScheduleState,
  SetOccurrenceStateInput,
  SetOccurrenceStateResult,
} from './types.js';

export type RecurringDataClient = PlanningRpcClient;

const SCHEDULE_KINDS = ['income', 'expense', 'debt_payment'] as const;
const SCHEDULE_STATES = ['active', 'paused', 'ended'] as const;
const SCHEDULE_CADENCES = ['weekly', 'monthly', 'yearly'] as const;
const OCCURRENCE_STATES: readonly OccurrenceState[] = ['pending', 'partial', 'settled', 'skipped'];

const MAX_PAGE_ROWS = 100;

/** Converts a bigint-identifier string into the JS number RPC callers use for
 * a `bigint` SQL parameter, matching the existing Goals/Allocation gateways'
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

/** Both cursor fields must be present or both absent -- a partial cursor is
 * rejected client-side too, mirroring `scheduled_occurrence_page`'s own guard. */
function requireCompleteCursor(fields: readonly (string | null)[], field: string): void {
  const presentCount = fields.filter((value) => value !== null).length;
  if (presentCount !== 0 && presentCount !== fields.length) {
    throw new Error(`Incomplete ${field} cursor.`);
  }
}

function occurrenceRow(value: unknown): ScheduledOccurrenceRow {
  const row = object(value);
  return {
    id: uuid(row['id'], 'id'),
    scheduleId: uuid(row['scheduleId'], 'scheduleId'),
    sourceRevisionId: bigIntId(row['sourceRevisionId'], 'sourceRevisionId'),
    currentEventId: row['currentEventId'] === null || row['currentEventId'] === undefined
      ? null : bigIntId(row['currentEventId'], 'currentEventId'),
    currency: currency(row['currency']),
    kind: enumValue(row['kind'], SCHEDULE_KINDS, 'kind'),
    nameEn: row['nameEn'] === null || row['nameEn'] === undefined ? null : string(row['nameEn'], 'nameEn'),
    nameAr: row['nameAr'] === null || row['nameAr'] === undefined ? null : string(row['nameAr'], 'nameAr'),
    dueDate: date(row['dueDate']),
    expectedMinor: minor(row['expectedMinor']),
    settledMinor: minor(row['settledMinor']),
    remainingMinor: minor(row['remainingMinor']),
    state: enumValue(row['state'], OCCURRENCE_STATES, 'state'),
    overdue: boolean(row['overdue'], 'overdue'),
    categoryId: nullableUuid(row['categoryId'], 'categoryId'),
    loanId: nullableUuid(row['loanId'], 'loanId'),
    fundingGoalId: nullableUuid(row['fundingGoalId'], 'fundingGoalId'),
    preferredWalletId: nullableUuid(row['preferredWalletId'], 'preferredWalletId'),
    fundingShortfallMinor: nullableMinor(row['fundingShortfallMinor']),
    asOf: date(row['asOf']),
  };
}

function parseOccurrencePage(value: unknown): ScheduledOccurrencePage {
  const row = object(value);
  const rows = uniqueBy(array(row['rows'], 'rows', MAX_PAGE_ROWS).map(occurrenceRow), (item) => item.id, 'id');
  const cursor = row['nextCursor'];
  return {
    rows,
    hasMore: boolean(row['hasMore'], 'hasMore'),
    nextCursor: cursor === null || cursor === undefined ? null : (() => {
      const cursorRow = object(cursor);
      return { dueDate: date(cursorRow['dueDate']), id: uuid(cursorRow['id'], 'nextCursor.id') };
    })(),
    asOf: date(row['asOf']),
  };
}

function saveScheduleResult(value: unknown): SaveScheduleResult {
  const row = object(value);
  return { scheduleId: uuid(row['scheduleId'], 'scheduleId'), revisionId: bigIntId(row['revisionId'], 'revisionId') };
}

function materializeResult(value: unknown): MaterializeResult {
  const row = object(value);
  return {
    createdCount: integer(row['createdCount'], 'createdCount'),
    existingCount: integer(row['existingCount'], 'existingCount'),
    fromDate: date(row['fromDate']),
    toDate: date(row['toDate']),
  };
}

function setOccurrenceStateResult(value: unknown): SetOccurrenceStateResult {
  const row = object(value);
  return { occurrenceId: uuid(row['occurrenceId'], 'occurrenceId'), eventId: bigIntId(row['eventId'], 'eventId') };
}

function confirmResult(value: unknown): ConfirmResult {
  const row = object(value);
  return {
    occurrenceId: uuid(row['occurrenceId'], 'occurrenceId'),
    occurrenceEventId: bigIntId(row['occurrenceEventId'], 'occurrenceEventId'),
    financialEventId: uuid(row['financialEventId'], 'financialEventId'),
  };
}

function linkExistingResult(value: unknown): LinkExistingResult {
  const row = object(value);
  return {
    occurrenceId: uuid(row['occurrenceId'], 'occurrenceId'),
    occurrenceEventId: bigIntId(row['occurrenceEventId'], 'occurrenceEventId'),
    financialEventId: uuid(row['financialEventId'], 'financialEventId'),
  };
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

/** `save_schedule`'s exact `p_definition` key list (task 14's own contract) --
 * unknown keys reject server-side, so the client never sends a field the DB
 * doesn't declare either. */
function definitionArg(definition: ScheduleDefinitionInput): Record<string, unknown> {
  return {
    currency: currency(definition.currency),
    kind: enumValue<ScheduleKind>(definition.kind, SCHEDULE_KINDS, 'definition.kind'),
    state: enumValue<ScheduleState>(definition.state, SCHEDULE_STATES, 'definition.state'),
    nameEn: definition.nameEn,
    nameAr: definition.nameAr,
    expectedMinor: planningMoneyInput(definition.expectedMinor),
    startsOn: date(definition.startsOn),
    endsOn: definition.endsOn === null ? null : date(definition.endsOn),
    cadence: enumValue<ScheduleCadence>(definition.cadence, SCHEDULE_CADENCES, 'definition.cadence'),
    intervalCount: integer(definition.intervalCount, 'definition.intervalCount'),
    categoryId: definition.categoryId,
    loanId: definition.loanId,
    fundingGoalId: definition.fundingGoalId,
    preferredWalletId: definition.preferredWalletId,
  };
}

export function createSupabaseRecurringGateway(client: RecurringDataClient): RecurringGateway {
  return {
    async loadOccurrences(input: LoadOccurrencesInput, signal?: AbortSignal) {
      requireCompleteCursor([input.afterDueDate, input.afterId], 'occurrence page');
      const data = await planningRpc(client, 'scheduled_occurrence_page', {
        p_space_id: input.spaceId,
        p_from_date: date(input.fromDate),
        p_to_date: date(input.toDate),
        p_after_due_date: input.afterDueDate === null ? null : date(input.afterDueDate),
        p_after_id: input.afterId,
        p_limit: input.limit,
      }, signal);
      return parseOccurrencePage(data);
    },

    async saveSchedule(input: SaveScheduleInput): Promise<SaveScheduleResult> {
      const data = await planningRpc(client, 'save_schedule', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_schedule_id: input.scheduleId,
        p_expected_revision_id: nullableBigIntArg(input.expectedRevisionId, 'expectedRevisionId'),
        p_definition: definitionArg(input.definition),
      });
      return saveScheduleResult(data);
    },

    async materialize(input: MaterializeInput): Promise<MaterializeResult> {
      const data = await planningRpc(client, 'materialize_schedule_occurrences', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_from_date: date(input.fromDate),
        p_to_date: date(input.toDate),
      });
      return materializeResult(data);
    },

    async setOccurrenceState(input: SetOccurrenceStateInput): Promise<SetOccurrenceStateResult> {
      const data = await planningRpc(client, 'set_occurrence_state', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_occurrence_id: input.occurrenceId,
        p_expected_event_id: nullableBigIntArg(input.expectedEventId, 'expectedEventId'),
        p_action: input.action,
      });
      return setOccurrenceStateResult(data);
    },

    async confirm(input: ConfirmInput): Promise<ConfirmResult> {
      const data = await planningRpc(client, 'confirm_scheduled_occurrence', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_occurrence_id: input.occurrenceId,
        p_expected_event_id: nullableBigIntArg(input.expectedEventId, 'expectedEventId'),
        p_actual_amount_minor: planningMoneyInput(input.actualAmountMinor),
        p_effective_date: date(input.effectiveDate),
        p_wallet_id: input.walletId,
      });
      return confirmResult(data);
    },

    async linkExisting(input: LinkExistingInput): Promise<LinkExistingResult> {
      const data = await planningRpc(client, 'link_scheduled_payment', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_occurrence_id: input.occurrenceId,
        p_event_id: input.eventId,
        p_amount_minor: planningMoneyInput(input.amountMinor),
        p_expected_event_id: nullableBigIntArg(input.expectedEventId, 'expectedEventId'),
      });
      return linkExistingResult(data);
    },

    async findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null> {
      const data = await planningRpc(client, 'find_planning_command', { p_space_id: spaceId, p_request_id: requestId });
      return receiptResult(data);
    },
  };
}
