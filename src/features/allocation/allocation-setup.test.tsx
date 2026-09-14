import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    expect(publishMonth).toHaveBeenCalledTimes(1);
    expect(publishMonth.mock.calls[0]![0]).toMatchObject({ templateRevisionId: '77' });
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });

  it('does not call publishMonth when saveTemplate itself goes ambiguous, and keeps the editor open', async () => {
    const saveTemplate = vi.fn(async (_input: Omit<SaveTemplateInput, 'spaceId' | 'requestId'>) => ({ status: 'ambiguous', reconciled: false }) as CommandOutcome);
    const publishMonth = vi.fn(async (_input: Omit<PublishMonthInput, 'spaceId' | 'requestId' | 'month' | 'currency'>) => ({ status: 'success', reconciled: false, result: { snapshotId: '1', incomeRevisionId: '1' } }) as CommandOutcome);
    render(<AllocationSetup locale="en" currency="USD" month="2026-09-01" categories={categories} allocation={fakeAllocation({ saveTemplate, publishMonth })} gateway={stubGateway} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
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
});
