import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { AllocationSetup } from './allocation-setup.js';
import type { AllocationGateway, AllocationMonthState, PublishMonthInput, SaveTemplateInput } from './types.js';
import type { CommandOutcome, useAllocation } from './use-allocation.js';

type AllocationHook = ReturnType<typeof useAllocation>;

const emptyMonth: AllocationMonthState = {
  snapshotId: null, templateRevisionId: null, incomeRevisionId: null, hasPlan: false,
  plannedIncomeMinor: null, actualIncomeMinor: '0', expenseMinor: '0', incomeAfterSpendingMinor: '0',
  ownDebtPaidMinor: '0', remainingDebtMinor: '0', leftToAllocateMinor: null, childPlanChanged: false,
  asOf: '2026-09-14T12:00:00Z', groups: [],
};

function fakeAllocation(overrides: Partial<AllocationHook> = {}): AllocationHook {
  return {
    status: 'ready',
    month: emptyMonth,
    error: null,
    pending: false,
    ambiguous: null,
    refresh: vi.fn(async () => true),
    saveTemplate: vi.fn(async (_input: Omit<SaveTemplateInput, 'spaceId' | 'requestId'>) => ({ status: 'success', reconciled: false, result: { templateRevisionId: '9' } }) as CommandOutcome),
    publishMonth: vi.fn(async (_input: Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>) => ({ status: 'success', reconciled: false, result: { snapshotId: '1', incomeRevisionId: '1' } }) as CommandOutcome),
    retryAmbiguous: vi.fn(async () => ({ status: 'success', reconciled: true }) as CommandOutcome),
    clearAmbiguous: vi.fn(),
    loadCategoryPage: vi.fn(async () => ({ rows: [], nextRootId: null, hasMore: false })),
    loadHistoryPage: vi.fn(async () => ({ rows: [], nextId: null, hasMore: false })),
    loadTrend: vi.fn(async () => ({ months: [] })),
    loadTemplateHead: vi.fn(async () => ({ templateRevisionId: null })),
    ...overrides,
  } as AllocationHook;
}

const categories = [{ id: 'cat-essentials', nameEn: 'Essentials', nameAr: 'أساسيات' }];
const stubGateway = {} as AllocationGateway;

describe('AllocationSetup', () => {
  it('shows a loading placeholder while the month is loading', () => {
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ status: 'loading' })} gateway={stubGateway} />);
    expect(screen.getByText('Loading allocation…')).toBeInTheDocument();
  });

  it('shows a retryable error banner and calls refresh', async () => {
    const refresh = vi.fn(async () => true);
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ status: 'error', error: { code: 'unknown', message: 'boom', recovery: '' }, refresh })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows "Set up" for a month with no plan and opens the editor in manual mode', async () => {
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation()} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(screen.getByRole('radio', { name: 'Manual (targets only)' })).toBeChecked();
  });

  it('Cancel in the editor returns to the overview', async () => {
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation()} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });

  it('Confirm chains saveTemplate then publishMonth with the freshly saved template revision id, then closes the editor', async () => {
    const saveTemplate = vi.fn(async (_input: Omit<SaveTemplateInput, 'spaceId' | 'requestId'>) => ({ status: 'success', reconciled: false, result: { templateRevisionId: '77' } }) as CommandOutcome);
    const publishMonth = vi.fn(async (_input: Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>) => ({ status: 'success', reconciled: false, result: { snapshotId: '1', incomeRevisionId: '1' } }) as CommandOutcome);
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ saveTemplate, publishMonth })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    expect(publishMonth).toHaveBeenCalledTimes(1);
    expect(publishMonth.mock.calls[0]![0]).toMatchObject({ templateRevisionId: '77' });
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });

  it('publishes a month without a snapshot against the current template head (audit B1, B2)', async () => {
    const saveTemplate = vi.fn(async (_input: Omit<SaveTemplateInput, 'spaceId' | 'requestId'>) => ({ status: 'success', reconciled: false, result: { templateRevisionId: '10' } }) as CommandOutcome);
    const publishMonth = vi.fn(async (_input: Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>) => ({ status: 'success', reconciled: false, result: { snapshotId: '2', incomeRevisionId: '5' } }) as CommandOutcome);
    const loadTemplateHead = vi.fn(async () => ({ templateRevisionId: '9' }));
    render(<AllocationSetup locale="en" currency="USD" month="2026-10-01" categories={categories}
      allocation={fakeAllocation({ saveTemplate, publishMonth, loadTemplateHead })} gateway={stubGateway}
      monthlyPlanIncomeMinor="200000" monthlyPlanIncomeRevisionId="31" />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ expectedRevisionId: '9' }));
    expect(publishMonth).toHaveBeenCalledWith(expect.objectContaining({ templateRevisionId: '10', expectedIncomeRevisionId: '31' }));
  });

  // Final review M5: the Plan heads a publish consumed are stale once it
  // succeeds, so the parent is told to refresh them.
  it('calls onPublished once a publish succeeds, so the Plan heads can refresh', async () => {
    const onPublished = vi.fn();
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation()} gateway={stubGateway} onPublished={onPublished} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onPublished).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['en', 'This plan changed elsewhere. Reload the current version and review it before saving again.'],
    ['ar', 'تغيّرت هذه الخطة من مكان آخر. أعد تحميل النسخة الحالية وراجعها قبل الحفظ مرة أخرى.'],
  ] as const)('shows the stale-revision copy (%s), not a generic error, when the plan changed under a publish', async (locale, copy) => {
    const onPublished = vi.fn();
    const publishMonth = vi.fn(async () => {
      throw postgrestRejection('P0001', 'the monthly budget plan has changed; refresh and try again');
    });
    render(<AllocationSetup locale={locale} currency="USD" month="2026-09-01" categories={categories}
      allocation={fakeAllocation({ publishMonth })} gateway={stubGateway} onPublished={onPublished} />);
    await userEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'إعداد' : 'Set up' }));
    await userEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'تأكيد' : 'Confirm' }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.queryByText(/Could not save this plan|تعذر حفظ هذه الخطة/)).toBeNull();
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('does not call publishMonth when saveTemplate itself goes ambiguous, and keeps the editor open', async () => {
    const saveTemplate = vi.fn(async (_input: Omit<SaveTemplateInput, 'spaceId' | 'requestId'>) => ({ status: 'ambiguous', reconciled: false }) as CommandOutcome);
    const publishMonth = vi.fn(async (_input: Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>) => ({ status: 'success', reconciled: false, result: { snapshotId: '1', incomeRevisionId: '1' } }) as CommandOutcome);
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ saveTemplate, publishMonth })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    expect(publishMonth).not.toHaveBeenCalled();
    expect(screen.getByRole('form', { name: 'Allocation setup' })).toBeInTheDocument();
  });

  it('shows the accepted-refresh-pending banner with a working Refresh action', async () => {
    const refresh = vi.fn(async () => true);
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ status: 'accepted-refresh-pending', refresh })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the ambiguous banner with Check again and Dismiss actions', async () => {
    const retryAmbiguous = vi.fn(async () => ({ status: 'success', reconciled: true }) as CommandOutcome);
    const clearAmbiguous = vi.fn();
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ status: 'ambiguous', retryAmbiguous, clearAmbiguous })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(retryAmbiguous).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(clearAmbiguous).toHaveBeenCalledTimes(1);
  });

  it('opens a drilldown dialog with the loaded category rows for the pressed group', async () => {
    const loadCategoryPage = vi.fn(async () => ({
      rows: [{ rootId: 'cat-essentials', nameEn: 'Essentials', nameAr: null, targetMinor: '1000', actualMinor: '500', varianceMinor: '500', hasPlan: true, groupId: 'g1' }],
      nextRootId: null, hasMore: false,
    }));
    const monthWithGroup: AllocationMonthState = {
      ...emptyMonth, hasPlan: true, snapshotId: '12',
      groups: [{ groupId: 'g1', rowKind: 'spending', nameEn: 'Essentials group', nameAr: null, order: 0, targetMinor: '1000', actualMinor: '500', varianceMinor: '500', basisPoints: 10000, actualShareOfIncomeBps: null, hasPlan: true }],
    };
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ month: monthWithGroup, loadCategoryPage })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Essentials group categories' }));
    expect(loadCategoryPage).toHaveBeenCalledWith({ snapshotId: '12', groupId: 'g1', afterRootId: null, limit: 100 });
    expect(await screen.findByRole('dialog', { name: 'Category detail' })).toBeInTheDocument();
  });

  it('prefills the editor income from the monthly plan over the stale published snapshot', async () => {
    const monthWithStaleIncome: AllocationMonthState = { ...emptyMonth, hasPlan: true, snapshotId: '12', plannedIncomeMinor: '40000' };
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ month: monthWithStaleIncome })} gateway={stubGateway} monthlyPlanIncomeMinor="75000" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Planned income')).toHaveValue('750.00');
    expect(screen.getByText('From the monthly plan: $750.00. Confirming this setup updates it.')).toBeInTheDocument();
  });

  it('falls back to the published snapshot for the initial income when the plan has none', async () => {
    const monthWithStaleIncome: AllocationMonthState = { ...emptyMonth, hasPlan: true, snapshotId: '12', plannedIncomeMinor: '40000' };
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ month: monthWithStaleIncome })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Planned income')).toHaveValue('400.00');
    expect(screen.queryByText(/From the monthly plan:/)).not.toBeInTheDocument();
  });

  it('pre-fills a category target from the Plan, not the older snapshot (audit B3)', async () => {
    const loadCategoryPage = vi.fn(async () => ({
      rows: [{ rootId: 'cat-essentials', nameEn: 'Essentials', nameAr: 'أساسيات', targetMinor: '40000', actualMinor: '0', varianceMinor: '40000', hasPlan: true, groupId: null }],
      nextRootId: null, hasMore: false,
    }));
    const planTargets = new Map([['cat-essentials', { amountMinor: '50000', revisionId: '12' }]]);
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories}
      allocation={fakeAllocation({ month: { ...emptyMonth, snapshotId: '12', hasPlan: true }, loadCategoryPage })}
      gateway={stubGateway} categoryTargets={planTargets} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit|Set up/ }));
    // Manual mode (no groups) opens on the mode/income step; Next reaches the
    // categories step where the pre-filled target renders.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByDisplayValue('500.00')).toBeInTheDocument();
  });
});
