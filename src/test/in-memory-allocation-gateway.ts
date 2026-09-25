import type {
  AllocationCategoryPage,
  AllocationGateway,
  AllocationHistoryPage,
  AllocationMonthState,
  AllocationTrend,
  LoadCategoryPageInput,
  LoadHistoryPageInput,
  LoadMonthInput,
  LoadTemplateHeadInput,
  LoadTrendInput,
  PlanningCommandReceipt,
  PublishMonthInput,
  PublishMonthResult,
  PublishMonthV2Input,
  SaveTemplateInput,
  SaveTemplateResult,
  TemplateHeadResult,
} from '../features/allocation/types.js';

/** Same shape `planningRpc` throws for a stale-revision rejection (SQLSTATE
 * 40001): a plain `{code, message}` object, not an `Error` instance --
 * `planningRpc` does `throw result.error`, and `RpcResult['error']` is a plain
 * `{code?, message}` object (see `planning-shared/rpc.ts`). */
function staleRevisionError(): { code: string; message: string } {
  return { code: '40001', message: 'planning_stale_revision' };
}

export const emptyMonthState: AllocationMonthState = {
  snapshotId: null, templateRevisionId: null, incomeRevisionId: null, hasPlan: false,
  plannedIncomeMinor: null, actualIncomeMinor: '0', expenseMinor: '0', incomeAfterSpendingMinor: '0',
  ownDebtPaidMinor: '0', remainingDebtMinor: '0', leftToAllocateMinor: null, childPlanChanged: false,
  asOf: '2026-09-14T12:00:00Z',
  groups: [
    { groupId: null, rowKind: 'unmapped', nameEn: null, nameAr: null, order: null, targetMinor: '0', actualMinor: '0', varianceMinor: '0', basisPoints: null, actualShareOfIncomeBps: null, hasPlan: false },
    { groupId: null, rowKind: 'uncategorized', nameEn: null, nameAr: null, order: null, targetMinor: null, actualMinor: '0', varianceMinor: null, basisPoints: null, actualShareOfIncomeBps: null, hasPlan: false },
  ],
};

/** Plan-pack fixture: 200000 planned / 180000 received, Essentials 112000/118000,
 * Lifestyle 48000/43000, Future 40000 target with 15000 paid. */
export const coreMonthStateFixture: AllocationMonthState = {
  snapshotId: '12', templateRevisionId: '9', incomeRevisionId: '30001', hasPlan: true,
  plannedIncomeMinor: '200000', actualIncomeMinor: '180000', expenseMinor: '161000',
  incomeAfterSpendingMinor: '19000', ownDebtPaidMinor: '15000', remainingDebtMinor: '0',
  leftToAllocateMinor: '0', childPlanChanged: false, asOf: '2026-09-14T12:00:00Z',
  groups: [
    {
      groupId: '00000000-0000-4000-8000-000000000001', rowKind: 'spending', nameEn: 'Essentials', nameAr: null,
      order: 0, targetMinor: '112000', actualMinor: '118000', varianceMinor: '-6000', basisPoints: 5600,
      actualShareOfIncomeBps: '6555', hasPlan: true,
    },
    {
      groupId: '00000000-0000-4000-8000-000000000002', rowKind: 'spending', nameEn: 'Lifestyle', nameAr: null,
      order: 1, targetMinor: '48000', actualMinor: '43000', varianceMinor: '5000', basisPoints: 2400,
      actualShareOfIncomeBps: '2388', hasPlan: true,
    },
    {
      groupId: '00000000-0000-4000-8000-000000000003', rowKind: 'future', nameEn: 'Future', nameAr: null,
      order: 2, targetMinor: '40000', actualMinor: '15000', varianceMinor: '25000', basisPoints: 2000,
      actualShareOfIncomeBps: '833', hasPlan: true,
    },
    { groupId: null, rowKind: 'unmapped', nameEn: null, nameAr: null, order: null, targetMinor: '0', actualMinor: '0', varianceMinor: '0', basisPoints: null, actualShareOfIncomeBps: '0', hasPlan: false },
    { groupId: null, rowKind: 'uncategorized', nameEn: null, nameAr: null, order: null, targetMinor: null, actualMinor: '0', varianceMinor: null, basisPoints: null, actualShareOfIncomeBps: '0', hasPlan: false },
  ],
};

export class InMemoryAllocationGateway implements AllocationGateway {
  monthState: AllocationMonthState = emptyMonthState;
  categoryPage: AllocationCategoryPage = { rows: [], nextRootId: null, hasMore: false };
  historyPage: AllocationHistoryPage = { rows: [], nextId: null, hasMore: false };
  trendResult: AllocationTrend = { months: [] };
  error: Error | null = null;
  loadDelayMs = 0;
  calls: Array<{ name: string; input: unknown }> = [];
  receipts = new Map<string, PlanningCommandReceipt>();
  nextTemplateRevisionId = 1;
  nextSnapshotId = 1;
  nextIncomeRevisionId = 1;
  /** The space's current template revision, independent of any month's own
   * (possibly null) snapshot -- enforced by `saveTemplate` the same way SQL
   * enforces it against `allocation_template_head` (audit B1). */
  templateHead: string | null = null;
  /** `${month}|${currency}` -> the Plan's current income revision for that
   * month and currency -- enforced by `publishMonth`/`publishMonthV2` the same
   * way SQL enforces it (audit B2). */
  incomeHeads = new Map<string, string | null>();

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

  async loadMonth(input: LoadMonthInput, signal?: AbortSignal): Promise<AllocationMonthState> {
    return this.settle('loadMonth', input, () => this.monthState, signal);
  }

  async loadCategoryPage(input: LoadCategoryPageInput, signal?: AbortSignal): Promise<AllocationCategoryPage> {
    return this.settle('loadCategoryPage', input, () => this.categoryPage, signal);
  }

  async loadHistoryPage(input: LoadHistoryPageInput, signal?: AbortSignal): Promise<AllocationHistoryPage> {
    return this.settle('loadHistoryPage', input, () => this.historyPage, signal);
  }

  async loadTrend(input: LoadTrendInput, signal?: AbortSignal): Promise<AllocationTrend> {
    return this.settle('loadTrend', input, () => this.trendResult, signal);
  }

  async loadTemplateHead(input: LoadTemplateHeadInput): Promise<TemplateHeadResult> {
    this.calls.push({ name: 'loadTemplateHead', input });
    return { templateRevisionId: this.templateHead };
  }

  async saveTemplate(input: SaveTemplateInput): Promise<SaveTemplateResult> {
    this.calls.push({ name: 'saveTemplate', input });
    if (this.error) throw this.error;
    const existing = this.receipts.get(input.requestId);
    if (existing) return existing.result as SaveTemplateResult;
    if ((input.expectedRevisionId ?? null) !== this.templateHead) throw staleRevisionError();
    const result: SaveTemplateResult = { templateRevisionId: String(this.nextTemplateRevisionId++) };
    this.receipts.set(input.requestId, { command: 'save_allocation_template', sequenceId: String(this.receipts.size + 1), result });
    this.templateHead = result.templateRevisionId;
    return result;
  }

  async publishMonth(input: PublishMonthInput): Promise<PublishMonthResult> {
    this.calls.push({ name: 'publishMonth', input });
    if (this.error) throw this.error;
    const existing = this.receipts.get(input.requestId);
    if (existing) return existing.result as PublishMonthResult;
    const incomeHeadKey = `${input.month}|${input.currency}`;
    if ((input.expectedIncomeRevisionId ?? null) !== (this.incomeHeads.get(incomeHeadKey) ?? null)) throw staleRevisionError();
    const result: PublishMonthResult = { snapshotId: String(this.nextSnapshotId++), incomeRevisionId: String(this.nextIncomeRevisionId++) };
    this.receipts.set(input.requestId, { command: 'publish_allocation_month', sequenceId: String(this.receipts.size + 1), result });
    this.incomeHeads.set(incomeHeadKey, result.incomeRevisionId);
    return result;
  }

  async publishMonthV2(input: PublishMonthV2Input): Promise<PublishMonthResult> {
    this.calls.push({ name: 'publishMonthV2', input });
    if (this.error) throw this.error;
    const existing = this.receipts.get(input.requestId);
    if (existing) return existing.result as PublishMonthResult;
    const incomeHeadKey = `${input.month}|${input.currency}`;
    if ((input.expectedIncomeRevisionId ?? null) !== (this.incomeHeads.get(incomeHeadKey) ?? null)) throw staleRevisionError();
    const result: PublishMonthResult = { snapshotId: String(this.nextSnapshotId++), incomeRevisionId: String(this.nextIncomeRevisionId++) };
    this.receipts.set(input.requestId, { command: 'publish_allocation_month_v2', sequenceId: String(this.receipts.size + 1), result });
    this.incomeHeads.set(incomeHeadKey, result.incomeRevisionId);
    return result;
  }

  async findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null> {
    this.calls.push({ name: 'findCommand', input: { spaceId, requestId } });
    return this.receipts.get(requestId) ?? null;
  }
}
