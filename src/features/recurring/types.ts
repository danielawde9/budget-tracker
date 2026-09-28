import type { Currency } from '../loans/types.js';

export type ScheduleKind = 'income' | 'expense' | 'debt_payment';
export type ScheduleState = 'active' | 'paused' | 'ended';
export type ScheduleCadence = 'weekly' | 'monthly' | 'yearly';
export type OccurrenceState = 'pending' | 'partial' | 'settled' | 'skipped';
export type OccurrenceStateAction = 'skip' | 'reopen';

/** A definition snapshot exactly as `save_schedule` accepts it (task 14's own
 * exact key list) -- never an invitation to add a field the DB contract
 * doesn't declare. Schedule editing changes only not-yet-materialized dates:
 * an already materialized occurrence keeps its original amount/date/
 * references forever, no matter what a later revision says. */
export interface ScheduleDefinitionInput {
  readonly currency: Currency;
  readonly kind: ScheduleKind;
  readonly state: ScheduleState;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly expectedMinor: string;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly cadence: ScheduleCadence;
  readonly intervalCount: number;
  readonly categoryId: string | null;
  readonly loanId: string | null;
  readonly fundingGoalId: string | null;
  readonly preferredWalletId: string | null;
}

/** One `scheduled_occurrence_page` row -- task 14's exact field list.
 * `settledMinor` is derived from exact settlement links and reversals, never
 * from a mutable flag; `remainingMinor` is `max(expected-settled,0)` so an
 * overpaid bill still reports zero remaining rather than a negative number.
 * `overdue` is a separate boolean (due_date<asOf and remaining>0 and not
 * skipped), never inferred from `state` alone. */
export interface ScheduledOccurrenceRow {
  readonly id: string;
  readonly scheduleId: string;
  readonly sourceRevisionId: string;
  readonly currentEventId: string | null;
  /** The wallet event the newest still-live settlement link/confirm points at
   * (`occurrence_events.linked_event_id`), or null when nothing is currently
   * linked. Unlike `currentEventId` (the occurrence-event head), this is the
   * id `OccurrenceDetail` can reverse to unlink a match made earlier -- e.g.
   * by auto-settle on Record (audit D7). A `link`/`confirm` whose wallet
   * event is already reversed is not reported, so after a successful unlink
   * the field falls back to the next live payment or to null. Optional so
   * pre-existing hand-built row fixtures (the shared in-memory gateway) stay
   * assignable; both DB reads and the gateway parser always supply it. */
  readonly linkedEventId?: string | null;
  readonly currency: Currency;
  readonly kind: ScheduleKind;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly dueDate: string;
  readonly expectedMinor: string;
  readonly settledMinor: string;
  readonly remainingMinor: string;
  readonly state: OccurrenceState;
  readonly overdue: boolean;
  readonly categoryId: string | null;
  readonly loanId: string | null;
  readonly fundingGoalId: string | null;
  readonly preferredWalletId: string | null;
  readonly fundingShortfallMinor: string | null;
  readonly asOf: string;
}

export interface ScheduledOccurrencePageCursor {
  readonly dueDate: string;
  readonly id: string;
}

export interface ScheduledOccurrencePage {
  readonly rows: readonly ScheduledOccurrenceRow[];
  readonly hasMore: boolean;
  readonly nextCursor: ScheduledOccurrencePageCursor | null;
  readonly asOf: string;
}

export interface LoadOccurrencesInput {
  readonly spaceId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly afterDueDate: string | null;
  readonly afterId: string | null;
  readonly limit: number;
}

/** `scheduled_overdue_page` (task 11) has no date-range bound -- "overdue"
 * already means "due before the server's UTC today" -- so this input carries
 * only the keyset cursor and limit, unlike `LoadOccurrencesInput`. */
export interface LoadOverdueInput {
  readonly spaceId: string;
  readonly afterDueDate: string | null;
  readonly afterId: string | null;
  readonly limit: number;
}

export interface SaveScheduleInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly scheduleId: string;
  readonly expectedRevisionId: string | null;
  readonly definition: ScheduleDefinitionInput;
}

export interface SaveScheduleResult {
  readonly scheduleId: string;
  readonly revisionId: string;
}

export interface MaterializeInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export interface MaterializeResult {
  readonly createdCount: number;
  readonly existingCount: number;
  readonly fromDate: string;
  readonly toDate: string;
}

export interface SetOccurrenceStateInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly occurrenceId: string;
  readonly expectedEventId: string | null;
  readonly action: OccurrenceStateAction;
}

export interface SetOccurrenceStateResult {
  readonly occurrenceId: string;
  readonly eventId: string;
}

export interface ConfirmInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly occurrenceId: string;
  readonly expectedEventId: string | null;
  readonly actualAmountMinor: string;
  readonly effectiveDate: string;
  readonly walletId: string;
}

export interface ConfirmResult {
  readonly occurrenceId: string;
  readonly occurrenceEventId: string;
  readonly financialEventId: string;
}

export interface LinkExistingInput {
  readonly spaceId: string;
  readonly requestId: string;
  readonly occurrenceId: string;
  readonly eventId: string;
  readonly amountMinor: string;
  readonly expectedEventId: string | null;
}

export interface LinkExistingResult {
  readonly occurrenceId: string;
  readonly occurrenceEventId: string;
  readonly financialEventId: string;
}

export interface PlanningCommandReceipt {
  readonly command: string;
  readonly sequenceId: string;
  readonly result: unknown;
}

export interface RecurringGateway {
  loadOccurrences(input: LoadOccurrencesInput, signal?: AbortSignal): Promise<ScheduledOccurrencePage>;
  loadOverdue(input: LoadOverdueInput, signal?: AbortSignal): Promise<ScheduledOccurrencePage>;
  saveSchedule(input: SaveScheduleInput): Promise<SaveScheduleResult>;
  materialize(input: MaterializeInput): Promise<MaterializeResult>;
  setOccurrenceState(input: SetOccurrenceStateInput): Promise<SetOccurrenceStateResult>;
  confirm(input: ConfirmInput): Promise<ConfirmResult>;
  linkExisting(input: LinkExistingInput): Promise<LinkExistingResult>;
  findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null>;
}
