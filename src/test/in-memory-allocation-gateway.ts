import type {
  AllocationCategoryPage,
  AllocationGateway,
  AllocationHistoryPage,
  AllocationMonthState,
  AllocationTrend,
  CloseMonthInput,
  CloseMonthResult,
  ClosePreview,
  CopyMonthInput,
  CopyMonthResult,
  LoadCategoryPageInput,
  LoadHistoryPageInput,
  LoadMonthInput,
  LoadTemplateHeadInput,
  LoadTrendInput,
  MonthCopyPreview,
  PlanningCommandReceipt,
  PreviewCloseInput,
  PreviewCopyInput,
  PublishMonthInput,
  PublishMonthResult,
  PublishMonthV2Input,
  SaveTemplateInput,
  SaveTemplateResult,
  SetRolloverInput,
  SetRolloverResult,
  TemplateHeadResult,
} from '../features/allocation/types.js';
import { postgrestRejection } from './postgrest-rejection.js';

/** What `save_allocation_template` raises for a stale template head
 * (SQLSTATE 40001, `20260914120000_allocation_commands.sql`), in the plain
 * `{ code, message }` shape the real gateway rethrows (see
 * `postgrest-rejection.ts`). */
function staleTemplateHeadError() {
  return postgrestRejection('40001', 'planning_stale_revision');
}

/** What `publish_allocation_month` raises when the Plan's income revision
 * moved: the head is checked inside `set_monthly_income_plan`, which raises
 * P0001 with this message (`20260914100000_planning_command_foundation.sql`),
 * not 40001 -- the fake used to throw 40001 here, so no test could see what
 * a person really gets (final review M5). */
function planChangedError() {
  return postgrestRejection('P0001', 'the monthly budget plan has changed; refresh and try again');
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

/** Month-transitions copy preview fixture: source snapshot 12 (September)
 * copied into October, with the task 21 monetary subset (base 10000, carry
 * -2500, effective 7500) on the one root. */
export const copyPreviewFixture: MonthCopyPreview = {
  previewHash: 'a'.repeat(64),
  sourceSnapshotId: '12',
  sourceMonth: '2026-09-01',
  targetMonth: '2026-10-01',
  currency: 'USD',
  expectedTargetSnapshotId: null,
  templateRevisionId: '9',
  expectedIncomeRevisionId: null,
  incomeMinor: '200000',
  loanGroupId: '00000000-0000-4000-8000-000000000003',
  carryCloseId: '7',
  roots: [
    {
      categoryId: '00000000-0000-4000-8000-000000000010', nameEn: 'Groceries', nameAr: 'بقالة',
      groupId: '00000000-0000-4000-8000-000000000001',
      baseMinor: '10000', carryMinor: '-2500', effectiveMinor: '7500',
      actualMinor: null, outgoingCarryMinor: null, expectedRevisionId: null,
    },
  ],
  groups: [
    {
      groupId: '00000000-0000-4000-8000-000000000001', nameEn: 'Essentials', nameAr: 'الأساسيات',
      purpose: 'spending', order: 0, basisPoints: 5600, targetMinor: '112000', carryMinor: '-2500', effectiveMinor: '109500',
    },
  ],
  goals: [],
  omissions: [{ entityId: '33333333-3333-4333-8333-333333333333', kind: 'root', reason: 'archived' }],
  carrySources: [{ rootId: '00000000-0000-4000-8000-000000000010', sourceCloseId: '7', carryMinor: '-2500' }],
};

/** Month-transitions close preview fixture for September 2026. `enabled` and
 * `policyRevisionId` mirror the root's current rollover policy head. */
export const closePreviewFixture: ClosePreview = {
  previewHash: 'b'.repeat(64),
  month: '2026-09-01',
  currency: 'USD',
  snapshotId: '12',
  expectedCloseId: null,
  incomeMinor: '180000',
  spendingMinor: '161000',
  factCount: '42',
  factDigest: 'c'.repeat(64),
  restatementRequired: false,
  roots: [
    {
      categoryId: '00000000-0000-4000-8000-000000000010', nameEn: 'Groceries', nameAr: 'بقالة',
      groupId: '00000000-0000-4000-8000-000000000001',
      baseMinor: '10000', carryMinor: '0', effectiveMinor: '10000',
      actualMinor: '12500', outgoingCarryMinor: '-2500', enabled: false, policyRevisionId: null, carrySourceCloseId: null,
    },
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
  /** Month-transitions fixtures + heads. `previewCloseError` lets a test model
   * the `budget_month_not_ended`/`budget_month_close_requires_plan` refusals. */
  copyPreview: MonthCopyPreview = copyPreviewFixture;
  closePreview: ClosePreview = closePreviewFixture;
  previewCloseError: Error | null = null;
  nextCloseId = 100;
  nextRolloverRevisionId = 100;
  policyHeadByRoot = new Map<string, string | null>();

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
    if ((input.expectedRevisionId ?? null) !== this.templateHead) throw staleTemplateHeadError();
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
    if ((input.expectedIncomeRevisionId ?? null) !== (this.incomeHeads.get(incomeHeadKey) ?? null)) throw planChangedError();
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
    if ((input.expectedIncomeRevisionId ?? null) !== (this.incomeHeads.get(incomeHeadKey) ?? null)) throw planChangedError();
    const result: PublishMonthResult = { snapshotId: String(this.nextSnapshotId++), incomeRevisionId: String(this.nextIncomeRevisionId++) };
    this.receipts.set(input.requestId, { command: 'publish_allocation_month_v2', sequenceId: String(this.receipts.size + 1), result });
    this.incomeHeads.set(incomeHeadKey, result.incomeRevisionId);
    return result;
  }

  async findCommand(spaceId: string, requestId: string): Promise<PlanningCommandReceipt | null> {
    this.calls.push({ name: 'findCommand', input: { spaceId, requestId } });
    return this.receipts.get(requestId) ?? null;
  }

  async previewCopy(input: PreviewCopyInput, signal?: AbortSignal): Promise<MonthCopyPreview> {
    return this.settle('previewCopy', input, () => {
      if (input.sourceSnapshotId !== this.copyPreview.sourceSnapshotId) throw postgrestRejection('P0001', 'month_copy_source_not_found');
      return this.copyPreview;
    }, signal);
  }

  async copyMonth(input: CopyMonthInput): Promise<CopyMonthResult> {
    this.calls.push({ name: 'copyMonth', input });
    if (this.error) throw this.error;
    const existing = this.receipts.get(input.requestId);
    if (existing) return existing.result as CopyMonthResult;
    if (input.acceptedPreviewHash !== this.copyPreview.previewHash
      || (input.expectedTargetSnapshotId ?? null) !== this.copyPreview.expectedTargetSnapshotId) {
      throw postgrestRejection('40001', 'planning_stale_revision');
    }
    const result: CopyMonthResult = {
      snapshotId: String(this.nextSnapshotId++), sourceSnapshotId: input.sourceSnapshotId, previewHash: input.acceptedPreviewHash,
    };
    this.receipts.set(input.requestId, { command: 'copy_allocation_month', sequenceId: result.snapshotId, result });
    return result;
  }

  async previewClose(input: PreviewCloseInput, signal?: AbortSignal): Promise<ClosePreview> {
    return this.settle('previewClose', input, () => {
      if (this.previewCloseError) throw this.previewCloseError;
      return this.closePreview;
    }, signal);
  }

  async closeMonth(input: CloseMonthInput): Promise<CloseMonthResult> {
    this.calls.push({ name: 'closeMonth', input });
    if (this.error) throw this.error;
    const existing = this.receipts.get(input.requestId);
    if (existing) return existing.result as CloseMonthResult;
    if ((input.expectedCloseId ?? null) !== this.closePreview.expectedCloseId
      || input.acceptedPreviewHash !== this.closePreview.previewHash) {
      throw postgrestRejection('40001', 'planning_stale_revision');
    }
    const result: CloseMonthResult = {
      closeId: String(this.nextCloseId++), previewHash: input.acceptedPreviewHash, restatesCloseId: input.expectedCloseId,
    };
    this.receipts.set(input.requestId, { command: 'close_budget_month', sequenceId: result.closeId, result });
    return result;
  }

  async setRollover(input: SetRolloverInput): Promise<SetRolloverResult> {
    this.calls.push({ name: 'setRollover', input });
    if (this.error) throw this.error;
    const existing = this.receipts.get(input.requestId);
    if (existing) return existing.result as SetRolloverResult;
    if ((input.expectedRevisionId ?? null) !== (this.policyHeadByRoot.get(input.rootId) ?? null)) {
      throw postgrestRejection('40001', 'planning_stale_revision');
    }
    const revisionId = String(this.nextRolloverRevisionId++);
    this.policyHeadByRoot.set(input.rootId, revisionId);
    const result: SetRolloverResult = { revisionId };
    this.receipts.set(input.requestId, { command: 'set_rollover_policy', sequenceId: revisionId, result });
    return result;
  }
}
