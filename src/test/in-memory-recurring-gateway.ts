import type {
  ConfirmInput,
  ConfirmResult,
  LinkExistingInput,
  LinkExistingResult,
  LoadOccurrencesInput,
  MaterializeInput,
  MaterializeResult,
  PlanningCommandReceipt,
  RecurringGateway,
  SaveScheduleInput,
  SaveScheduleResult,
  ScheduledOccurrencePage,
  SetOccurrenceStateInput,
  SetOccurrenceStateResult,
} from '../features/recurring/types.js';

export const emptyOccurrencePage: ScheduledOccurrencePage = { rows: [], hasMore: false, nextCursor: null, asOf: '2026-09-14' };

/** One partially paid expense occurrence -- a complete, valid fixture for
 * component/hook tests. */
export const coreOccurrenceRowFixture = {
  id: '00000000-0000-4000-8000-000000000401',
  scheduleId: '00000000-0000-4000-8000-000000000301',
  sourceRevisionId: '1',
  currentEventId: '3',
  currency: 'USD' as const,
  kind: 'expense' as const,
  nameEn: 'Rent',
  nameAr: null,
  dueDate: '2026-09-30',
  expectedMinor: '50000',
  settledMinor: '20000',
  remainingMinor: '30000',
  state: 'partial' as const,
  overdue: false,
  categoryId: null,
  loanId: null,
  fundingGoalId: null,
  preferredWalletId: null,
  fundingShortfallMinor: null,
  asOf: '2026-09-14',
};

export const coreOccurrencePageFixture: ScheduledOccurrencePage = {
  rows: [coreOccurrenceRowFixture],
  hasMore: false,
  nextCursor: null,
  asOf: '2026-09-14',
};

export class InMemoryRecurringGateway implements RecurringGateway {
  page: ScheduledOccurrencePage = emptyOccurrencePage;
  error: Error | null = null;
  loadDelayMs = 0;
  calls: Array<{ name: string; input: unknown }> = [];
  receipts = new Map<string, PlanningCommandReceipt>();
  nextRevisionId = 1;
  nextEventId = 1;

  private async settle<T>(name: string, input: unknown, value: () => T, signal?: AbortSignal): Promise<T> {
    this.calls.push({ name, input });
    if (this.loadDelayMs > 0) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, this.loadDelayMs);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('AbortError')); }, { once: true });
    });
    if (signal?.aborted) throw new Error('AbortError');
    if (this.error) throw this.error;
    return value();
  }

  private mutate<T>(command: string, requestId: string, name: string, input: unknown, makeResult: () => T): T {
    this.calls.push({ name, input });
    if (this.error) throw this.error;
    const existing = this.receipts.get(requestId);
    if (existing) return existing.result as T;
    const result = makeResult();
    this.receipts.set(requestId, { command, sequenceId: String(this.receipts.size + 1), result });
    return result;
  }

  async loadOccurrences(input: LoadOccurrencesInput, signal?: AbortSignal): Promise<ScheduledOccurrencePage> {
    return this.settle('loadOccurrences', input, () => this.page, signal);
  }

  async saveSchedule(input: SaveScheduleInput): Promise<SaveScheduleResult> {
    return this.mutate('save_schedule', input.requestId, 'saveSchedule', input, () => ({
      scheduleId: input.scheduleId, revisionId: String(this.nextRevisionId++),
    }));
  }

  async materialize(input: MaterializeInput): Promise<MaterializeResult> {
    return this.mutate('materialize_schedule_occurrences', input.requestId, 'materialize', input, () => ({
      createdCount: 0, existingCount: 0, fromDate: input.fromDate, toDate: input.toDate,
    }));
  }

  async setOccurrenceState(input: SetOccurrenceStateInput): Promise<SetOccurrenceStateResult> {
    return this.mutate('set_occurrence_state', input.requestId, 'setOccurrenceState', input, () => ({
      occurrenceId: input.occurrenceId, eventId: String(this.nextEventId++),
    }));
  }

  async confirm(input: ConfirmInput): Promise<ConfirmResult> {
    return this.mutate('confirm_scheduled_occurrence', input.requestId, 'confirm', input, () => ({
      occurrenceId: input.occurrenceId, occurrenceEventId: String(this.nextEventId++),
      financialEventId: globalThis.crypto.randomUUID(),
    }));
  }

  async linkExisting(input: LinkExistingInput): Promise<LinkExistingResult> {
    return this.mutate('link_scheduled_payment', input.requestId, 'linkExisting', input, () => ({
      occurrenceId: input.occurrenceId, occurrenceEventId: String(this.nextEventId++), financialEventId: input.eventId,
    }));
  }

  async findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null> {
    this.calls.push({ name: 'findCommand', input: { spaceId, requestId } });
    return this.receipts.get(requestId) ?? null;
  }
}
