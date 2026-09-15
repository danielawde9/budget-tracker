import type {
  AvailableCashSummary,
  CashControlGateway,
  CashOutlook,
  LoadAvailableInput,
  LoadOutlookInput,
} from '../features/cash-control/types.js';

/** A complete, valid `ready`-state fixture for component/hook tests --
 * components sum consistently: cash100000 - claims0 - expenseCommitments
 * 50000 - debtCommitments0 - goalTopups0 - futureHeadroom0 = available50000,
 * matching `17-available-cash-db.md`'s own acceptance table row
 * (`C100000,R0,B50000,O30000,G0 -> Q50000,available50000`). */
export const coreAvailableCashSummaryFixture: AvailableCashSummary = {
  currency: 'USD', asOf: '2026-09-15', state: 'ready', needsReview: false, snapshotId: '12',
  cashMinor: '100000', goalClaimsMinor: '0',
  expenseCommitmentsMinor: '50000', debtCommitmentsMinor: '0', goalTopupsMinor: '0', futureHeadroomMinor: '0',
  availableMinor: '50000', deficitMinor: '0', spendableMinor: '50000', dailyExtraGuideMinor: '3333',
  daysRemaining: 15, receivedIncomeMinor: '80000', ordinarySpendingMinor: '30000', incomeMinusSpendingMinor: '50000',
  uncategorizedMinor: '0', unmaterializedCount: 0,
  groups: [{
    id: '00000000-0000-4000-8000-000000000901', nameEn: 'Essentials', nameAr: null,
    budgetRemainingMinor: '20000', unpaidBillsMinor: '30000', goalOverlapMinor: '0', commitmentMinor: '50000',
  }],
};

export const emptyAvailableCashSummary: AvailableCashSummary = {
  currency: 'USD', asOf: '', state: 'unplanned', needsReview: false, snapshotId: null,
  cashMinor: '0', goalClaimsMinor: '0',
  expenseCommitmentsMinor: null, debtCommitmentsMinor: null, goalTopupsMinor: null, futureHeadroomMinor: null,
  availableMinor: null, deficitMinor: null, spendableMinor: null, dailyExtraGuideMinor: null,
  daysRemaining: 0, receivedIncomeMinor: '0', ordinarySpendingMinor: '0', incomeMinusSpendingMinor: '0',
  uncategorizedMinor: '0', unmaterializedCount: 0, groups: [],
};

export const coreCashOutlookFixture: CashOutlook = {
  currency: 'USD', startDate: '2026-09-15', scenario: 'expected',
  assumption: 'Projects only unpaid scheduled income and scheduled bills; unplanned day-to-day spending can still lower this line.',
  days: [{
    date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '50000', closingCashMinor: '50000',
  }],
  firstNegativeDate: null, state: 'ready', overdueCount: 0, overdueMinor: '0',
};

export const emptyCashOutlook: CashOutlook = {
  currency: 'USD', startDate: '', scenario: 'expected', assumption: '', days: [],
  firstNegativeDate: null, state: 'ready', overdueCount: 0, overdueMinor: '0',
};

export class InMemoryCashControlGateway implements CashControlGateway {
  available: AvailableCashSummary = emptyAvailableCashSummary;
  outlook: CashOutlook = emptyCashOutlook;
  error: Error | null = null;
  loadDelayMs = 0;
  calls: Array<{ name: string; input: unknown }> = [];

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

  async loadAvailable(input: LoadAvailableInput, signal?: AbortSignal): Promise<AvailableCashSummary> {
    return this.settle('loadAvailable', input, () => this.available, signal);
  }

  async loadOutlook(input: LoadOutlookInput, signal?: AbortSignal): Promise<CashOutlook> {
    return this.settle('loadOutlook', input, () => this.outlook, signal);
  }
}
