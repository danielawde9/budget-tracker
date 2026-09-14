import type {
  CreateGoalInput,
  CreateGoalResult,
  GoalDetail,
  GoalHistoryPage,
  GoalPage,
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
} from '../features/goals/types.js';

export const emptyGoalPage: GoalPage = { rows: [], hasMore: false, nextCursor: null, asOf: '2026-09-14T12:00:00Z' };

/** One reserve-kind goal, half-covered, with a checklist milestone -- a
 * complete, valid fixture for component/hook tests. */
export const coreGoalSummaryFixture = {
  id: '00000000-0000-4000-8000-000000000101',
  revisionId: '1',
  currency: 'USD' as const,
  kind: 'reserve' as const,
  state: 'active' as const,
  nameEn: 'Emergency fund',
  nameAr: null,
  targetMinor: '600000',
  earmarkedMinor: '60000',
  coveredMinor: '30000',
  fulfilledMinor: '0',
  shortageMinor: '30000',
  monthlyTargetMinor: '50000',
  monthlyNetContributionMinor: '10000',
  dueDate: null,
  horizon: 'open' as const,
  needsReview: false,
  suggestedMonthlyMinor: null,
  forecastMonth: null,
  forecastState: 'insufficient_history' as const,
  asOf: '2026-09-14T12:00:00Z',
};

export const coreGoalPageFixture: GoalPage = {
  rows: [coreGoalSummaryFixture],
  hasMore: false,
  nextCursor: null,
  asOf: '2026-09-14T12:00:00Z',
};

export const coreGoalDetailFixture: GoalDetail = {
  summary: coreGoalSummaryFixture,
  milestones: [
    {
      id: '00000000-0000-4000-8000-000000000201', kind: 'checklist', labelEn: 'Pick a bank', labelAr: null,
      thresholdMinor: null, dueDate: null, ordinal: 0, currentState: 'incomplete',
    },
  ],
  earmarkHead: 'a'.repeat(64),
  definitionHead: '1',
  asOf: '2026-09-14T12:00:00Z',
};

export const emptyGoalHistoryPage: GoalHistoryPage = { rows: [], hasMore: false, nextCursor: null };

export class InMemoryGoalsGateway implements GoalsGateway {
  page: GoalPage = emptyGoalPage;
  detail: GoalDetail = coreGoalDetailFixture;
  historyPage: GoalHistoryPage = emptyGoalHistoryPage;
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

  async loadPage(input: LoadGoalPageInput, signal?: AbortSignal): Promise<GoalPage> {
    return this.settle('loadPage', input, () => this.page, signal);
  }

  async loadDetail(input: LoadGoalDetailInput, signal?: AbortSignal): Promise<GoalDetail> {
    return this.settle('loadDetail', input, () => this.detail, signal);
  }

  async loadHistory(input: LoadGoalHistoryInput, signal?: AbortSignal): Promise<GoalHistoryPage> {
    return this.settle('loadHistory', input, () => this.historyPage, signal);
  }

  async create(input: CreateGoalInput): Promise<CreateGoalResult> {
    return this.mutate('create_goal_plan', input.requestId, 'create', input, () => ({
      goalId: input.goalId, revisionId: String(this.nextRevisionId++),
    }));
  }

  async revise(input: ReviseGoalInput): Promise<ReviseGoalResult> {
    return this.mutate('revise_goal_plan', input.requestId, 'revise', input, () => ({
      goalId: input.goalId, revisionId: String(this.nextRevisionId++),
    }));
  }

  async reserveOrRelease(input: ReserveOrReleaseInput): Promise<ReserveOrReleaseResult> {
    return this.mutate('record_goal_earmark', input.requestId, 'reserveOrRelease', input, () => ({
      eventId: String(this.nextEventId++), goalId: input.goalId,
    }));
  }

  async move(input: MoveEarmarkInput): Promise<MoveEarmarkResult> {
    return this.mutate('move_goal_earmark', input.requestId, 'move', input, () => ({
      eventId: String(this.nextEventId++),
    }));
  }

  async reverse(input: ReverseEarmarkInput): Promise<ReverseEarmarkResult> {
    return this.mutate('reverse_goal_earmark', input.requestId, 'reverse', input, () => ({
      eventId: String(this.nextEventId++),
    }));
  }

  async linkPurchase(input: LinkPurchaseInput): Promise<LinkPurchaseResult> {
    return this.mutate('link_goal_purchase', input.requestId, 'linkPurchase', input, () => ({
      linkIds: input.lines.map(() => globalThis.crypto.randomUUID()),
    }));
  }

  async setMonthlyTarget(input: SetMonthlyTargetInput): Promise<SetMonthlyTargetResult> {
    return this.mutate('set_goal_monthly_target', input.requestId, 'setMonthlyTarget', input, () => ({
      revisionId: String(this.nextRevisionId++),
    }));
  }

  async setMilestone(input: SetMilestoneInput): Promise<SetMilestoneResult> {
    return this.mutate('set_goal_milestone_state', input.requestId, 'setMilestone', input, () => ({
      eventId: String(this.nextEventId++),
    }));
  }

  async findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null> {
    this.calls.push({ name: 'findCommand', input: { spaceId, requestId } });
    return this.receipts.get(requestId) ?? null;
  }
}
