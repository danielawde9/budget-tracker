import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AllocationMonthEditor, type AllocationMonthEditorInitial, type CategoryOption } from './allocation-month-editor.js';

const categories: CategoryOption[] = [
  { id: 'cat-essentials', nameEn: 'Essentials', nameAr: 'أساسيات' },
  { id: 'cat-lifestyle', nameEn: 'Lifestyle', nameAr: 'نمط الحياة' },
];

function initial(overrides: Partial<AllocationMonthEditorInitial> = {}): AllocationMonthEditorInitial {
  return {
    incomeMajorText: '0',
    groups: [],
    rootTargets: [],
    loanGroupId: null,
    ...overrides,
  };
}

describe('AllocationMonthEditor', () => {
  it('starts in manual mode with no groups when the initial draft has none', () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial()} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Manual (targets only)' })).toBeChecked();
    expect(screen.queryByText('Add group')).not.toBeInTheDocument();
  });

  it('starts in percentage mode when the initial draft already has groups', () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({
      groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '56' }],
    })} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Percentage groups' })).toBeChecked();
    expect(screen.getByText('Add group')).toBeInTheDocument();
  });

  it('converts a two-decimal percent input to the exact preview amount (56.25% of 200000 -> 112500)', async () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({
      incomeMajorText: '2000',
      groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '0' }],
    })} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('Percent'));
    await userEvent.type(screen.getByLabelText('Percent'), '56.25');
    expect(screen.getByText('$1,125.00')).toBeInTheDocument();
  });

  it('U08-02-shaped preview: 5600/2400/2000 bps of 101 minor units previews as 57/24/20 with 0 unallocated', async () => {
    render(<AllocationMonthEditor locale="en" currency="LBP" categories={categories} initial={initial({
      incomeMajorText: '101',
      groups: [
        { id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'A', nameAr: '', percentText: '56' },
        { id: '00000000-0000-4000-8000-000000000002', purpose: 'spending', nameEn: 'B', nameAr: '', percentText: '24' },
        { id: '00000000-0000-4000-8000-000000000003', purpose: 'spending', nameEn: 'C', nameAr: '', percentText: '20' },
      ],
    })} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('LBP 57')).toBeInTheDocument();
    expect(screen.getByText('LBP 24')).toBeInTheDocument();
    expect(screen.getByText('LBP 20')).toBeInTheDocument();
    expect(screen.getByText(/Unallocated/)).toHaveTextContent('LBP 0');
  });

  it('switching to manual clears groups and mappings but preserves entered category target amounts', async () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({
      groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '100' }],
      rootTargets: [{ categoryId: 'cat-essentials', groupId: '00000000-0000-4000-8000-000000000001', amountMajorText: '500', expectedRevisionId: null }],
    })} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Manual (targets only)' }));
    expect(screen.queryByText('Add group')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Essentials target')).toHaveValue('500');
  });

  it('disables submit and shows a warning when assigned category targets exceed their group', async () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({
      incomeMajorText: '1000',
      groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '50' }],
      rootTargets: [{ categoryId: 'cat-essentials', groupId: '00000000-0000-4000-8000-000000000001', amountMajorText: '600', expectedRevisionId: null }],
    })} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Assigned category targets exceed this group.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('assembles the exact submission shape from a manual-mode draft: zero groups, explicit standalone root targets', async () => {
    const onSubmit = vi.fn();
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({ incomeMajorText: '1000' })} pending={false} error={null} onCancel={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.clear(screen.getByLabelText('Essentials target'));
    await userEvent.type(screen.getByLabelText('Essentials target'), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledWith({
      incomeMinor: '100000',
      groups: [],
      rootMappings: [],
      rootTargets: [
        { categoryId: 'cat-essentials', amountMinor: '40000', expectedRevisionId: null },
        { categoryId: 'cat-lifestyle', amountMinor: '0', expectedRevisionId: null },
      ],
      loanGroupId: null,
    });
  });

  it('assembles the exact submission shape from a percentage-mode draft, including root mappings', async () => {
    const onSubmit = vi.fn();
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({
      incomeMajorText: '1000',
      groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '100' }],
    })} pending={false} error={null} onCancel={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText('Essentials group'), '00000000-0000-4000-8000-000000000001');
    await userEvent.type(screen.getByLabelText('Essentials target'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      groups: [{ id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: null, order: 0, basisPoints: 10000 }],
      rootMappings: [{ categoryId: 'cat-essentials', groupId: '00000000-0000-4000-8000-000000000001' }],
    }));
  });

  it('uses one submission path for both Enter and the primary button (native form submit)', async () => {
    const onSubmit = vi.fn();
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({ incomeMajorText: '1000' })} pending={false} error={null} onCancel={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Planned income'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel and Confirm while pending, preventing a double submit', () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({ incomeMajorText: '1000' })} pending error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('preserves entered values and shows the server error on a recoverable rejection', () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({ incomeMajorText: '1000' })} pending={false} error="This plan changed elsewhere." onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Planned income')).toHaveValue('1000');
    expect(screen.getByText('This plan changed elsewhere.')).toBeInTheDocument();
  });

  it('renders Arabic category names via bdi', () => {
    render(<AllocationMonthEditor locale="ar" currency="USD" categories={categories} initial={initial()} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('أساسيات').closest('bdi')).not.toBeNull();
  });

  it('offers a Future group as a debt-link target but not as a category mapping target', () => {
    render(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({
      groups: [
        { id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '80' },
        { id: '00000000-0000-4000-8000-000000000002', purpose: 'future', nameEn: 'Debt', nameAr: '', percentText: '20' },
      ],
    })} pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    const linkSelect = screen.getByLabelText('Link debt payments to');
    expect(within(linkSelect).getByText('Debt')).toBeInTheDocument();
    const mappingSelect = screen.getByLabelText('Essentials group');
    expect(within(mappingSelect).queryByText('Debt')).not.toBeInTheDocument();
  });
});
