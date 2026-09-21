import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatMinorAmount } from '../wallets/money.js';
import { AllocationMonthEditor, type AllocationMonthEditorInitial, type CategoryOption } from './allocation-month-editor.js';

const categories: CategoryOption[] = [
  { id: 'cat-essentials', nameEn: 'Essentials', nameAr: 'أساسيات' },
  { id: 'cat-lifestyle', nameEn: 'Lifestyle', nameAr: 'نمط الحياة' },
];

const essentialsGroupId = '00000000-0000-4000-8000-000000000001';

function initial(overrides: Partial<AllocationMonthEditorInitial> = {}): AllocationMonthEditorInitial {
  return {
    incomeMajorText: '0',
    groups: [],
    rootTargets: [],
    loanGroupId: null,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<AllocationMonthEditorInitial> = {}, props: Partial<Parameters<typeof AllocationMonthEditor>[0]> = {}) {
  return render(
    <AllocationMonthEditor
      locale="en"
      currency="USD"
      categories={categories}
      initial={initial(overrides)}
      plannedIncomeMinor={null}
      pending={false}
      error={null}
      onCancel={vi.fn()}
      onSubmit={vi.fn()}
      {...props}
    />,
  );
}

/** Walk the wizard to the review step in the mode the draft starts in. */
async function walkToReview() {
  const isPercentage = (screen.getByRole('radio', { name: 'Percentage groups' }) as HTMLInputElement).checked;
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  if (isPercentage) {
    // Groups step: name any unnamed groups so the step gate passes.
    for (const input of screen.getAllByLabelText('Group name') as HTMLInputElement[]) {
      if (!input.value) await userEvent.type(input, 'Group');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  }
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
}

describe('AllocationMonthEditor', () => {
  it('starts in manual mode on the Mode and income step with no groups anywhere', () => {
    renderEditor();
    expect(screen.getByRole('radio', { name: 'Manual (targets only)' })).toBeChecked();
    expect(screen.queryByText('Add group')).not.toBeInTheDocument();
    // Manual mode skips the Groups step: the indicator shows 1 → 3 → 4.
    const progress = screen.getByLabelText('Progress');
    expect(within(progress).queryByText('Groups')).not.toBeInTheDocument();
    expect(within(progress).getByText('Categories')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mode and income' })).toBeInTheDocument();
  });

  it('starts in percentage mode when the initial draft already has groups', async () => {
    renderEditor({
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '56' }],
    });
    expect(screen.getByRole('radio', { name: 'Percentage groups' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByText('Add group')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Progress')).getByText('Groups')).toBeInTheDocument();
  });

  it('runs Next from Mode and income straight to Categories in manual mode, skipping Groups', async () => {
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByLabelText('Essentials target')).toBeInTheDocument();
  });

  it('keeps Next on Mode and income while the income does not parse, showing the existing alert once the field is edited', async () => {
    renderEditor({ incomeMajorText: 'abc' });
    // Pristine invalid text shows no alert until the user edits the field.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Planned income'));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid amount.');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Mode and income' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Essentials target')).not.toBeInTheDocument();
  });

  it('converts a two-decimal percent input to the exact preview amount (56.25% of 200000 -> 112500)', async () => {
    renderEditor({
      incomeMajorText: '2000',
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '0' }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.clear(screen.getByLabelText('Percent'));
    await userEvent.type(screen.getByLabelText('Percent'), '56.25');
    expect(screen.getByText('$1,125.00')).toBeInTheDocument();
  });

  it('U08-02-shaped preview: 5600/2400/2000 bps of 101 minor units previews as 57/24/20 with 0 unallocated', async () => {
    renderEditor({
      incomeMajorText: '101',
      groups: [
        { id: '00000000-0000-4000-8000-000000000001', purpose: 'spending', nameEn: 'A', nameAr: '', percentText: '56' },
        { id: '00000000-0000-4000-8000-000000000002', purpose: 'spending', nameEn: 'B', nameAr: '', percentText: '24' },
        { id: '00000000-0000-4000-8000-000000000003', purpose: 'spending', nameEn: 'C', nameAr: '', percentText: '20' },
      ],
    }, { currency: 'LBP' });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('LBP 57')).toBeInTheDocument();
    expect(screen.getByText('LBP 24')).toBeInTheDocument();
    expect(screen.getByText('LBP 20')).toBeInTheDocument();
    expect(screen.getByText(/Unallocated/)).toHaveTextContent('LBP 0');
  });

  it('blocks the Groups step Next until every group has a name', async () => {
    renderEditor({
      incomeMajorText: '1000',
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: '', nameAr: '', percentText: '50' }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name each group before continuing.');
    expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Group name'), 'Essentials');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
  });

  it('blocks the Categories step Next while a category target does not parse', async () => {
    renderEditor({
      incomeMajorText: '1000',
      rootTargets: [{ categoryId: 'cat-essentials', groupId: null, amountMajorText: 'abc', expectedRevisionId: null }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Essentials target')).toBeInvalid();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid amount.');
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
  });

  it('switching to manual clears groups and mappings but preserves entered category target amounts', async () => {
    renderEditor({
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '100' }],
      rootTargets: [{ categoryId: 'cat-essentials', groupId: essentialsGroupId, amountMajorText: '500', expectedRevisionId: null }],
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Manual (targets only)' }));
    expect(screen.queryByText('Add group')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Progress')).queryByText('Groups')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Essentials target')).toHaveValue('500');
  });

  it('Back from Review lands on Categories in manual mode, skipping the hidden Groups step', async () => {
    renderEditor({ incomeMajorText: '1000' });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument();
  });

  it('Back from Review walks through Groups in percentage mode', async () => {
    renderEditor({
      incomeMajorText: '1000',
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '100' }],
    });
    await walkToReview();
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument();
  });

  it('review summarizes mode, income, groups, and category targets as label/value rows', async () => {
    renderEditor({
      incomeMajorText: '1000',
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '50' }],
      rootTargets: [{ categoryId: 'cat-essentials', groupId: essentialsGroupId, amountMajorText: '400', expectedRevisionId: null }],
    });
    await walkToReview();
    const review = screen.getByRole('group', { name: 'Review' });
    expect(within(review).getByText('Mode')).toBeInTheDocument();
    expect(within(review).getByText('Percentage groups')).toBeInTheDocument();
    expect(within(review).getByText('Planned income')).toBeInTheDocument();
    expect(within(review).getByText('$1,000.00')).toBeInTheDocument();
    expect(within(review).getByText(/Spending/)).toBeInTheDocument();
    expect(within(review).getByText('$500.00')).toBeInTheDocument();
    expect(within(review).getByText('Essentials target')).toBeInTheDocument();
    expect(within(review).getByText('$400.00')).toBeInTheDocument();
  });

  it('disables Confirm and shows the existing warning when assigned category targets exceed their group', async () => {
    renderEditor({
      incomeMajorText: '1000',
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '50' }],
      rootTargets: [{ categoryId: 'cat-essentials', groupId: essentialsGroupId, amountMajorText: '600', expectedRevisionId: null }],
    });
    await walkToReview();
    expect(screen.getByRole('alert')).toHaveTextContent('Assigned category targets exceed this group.');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('assembles the exact submission shape from a manual-mode draft: zero groups, explicit standalone root targets', async () => {
    const onSubmit = vi.fn();
    renderEditor({ incomeMajorText: '1000' }, { onSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.clear(screen.getByLabelText('Essentials target'));
    await userEvent.type(screen.getByLabelText('Essentials target'), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
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
    renderEditor({
      incomeMajorText: '1000',
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '100' }],
    }, { onSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.selectOptions(screen.getByLabelText('Essentials group'), essentialsGroupId);
    await userEvent.type(screen.getByLabelText('Essentials target'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      groups: [{ id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: null, order: 0, basisPoints: 10000 }],
      rootMappings: [{ categoryId: 'cat-essentials', groupId: essentialsGroupId }],
    }));
  });

  it('treats Enter like the active footer button: it advances steps and submits from Review', async () => {
    const onSubmit = vi.fn();
    renderEditor({ incomeMajorText: '1000' }, { onSubmit });
    await userEvent.type(screen.getByLabelText('Planned income'), '{Enter}');
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Confirm' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel and Confirm while pending, preventing a double submit', async () => {
    renderEditor({ incomeMajorText: '1000' }, { pending: true });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('preserves entered values and shows the server error on a recoverable rejection', () => {
    renderEditor({ incomeMajorText: '1000' }, { error: 'This plan changed elsewhere.' });
    expect(screen.getByLabelText('Planned income')).toHaveValue('1000');
    expect(screen.getByText('This plan changed elsewhere.')).toBeInTheDocument();
  });

  it('renders Arabic category names via bdi', async () => {
    render(
      <AllocationMonthEditor
        locale="ar" currency="USD" categories={categories} initial={initial()} plannedIncomeMinor={null}
        pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(screen.getByText('أساسيات').closest('bdi')).not.toBeNull();
  });

  it('offers a Future group as a debt-link target but not as a category mapping target', async () => {
    renderEditor({
      groups: [
        { id: essentialsGroupId, purpose: 'spending', nameEn: 'Essentials', nameAr: '', percentText: '80' },
        { id: '00000000-0000-4000-8000-000000000002', purpose: 'future', nameEn: 'Debt', nameAr: '', percentText: '20' },
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    const linkSelect = screen.getByLabelText('Link debt payments to');
    expect(within(linkSelect).getByText('Debt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    const mappingSelect = screen.getByLabelText('Essentials group');
    expect(within(mappingSelect).queryByText('Debt')).not.toBeInTheDocument();
  });

  it('shows no plan helper under the income field when the plan has no income for the currency', () => {
    renderEditor({ incomeMajorText: '500.00' });
    expect(screen.queryByText(/From the monthly plan:/)).not.toBeInTheDocument();
  });

  it('shows the monthly-plan helper under the income field, linked via aria-describedby', () => {
    renderEditor({ incomeMajorText: '750.00' }, { plannedIncomeMinor: '75000' });
    const helper = screen.getByText('From the monthly plan: $750.00. Confirming this setup updates it.');
    expect(helper).toHaveClass('cr-helper');
    expect(screen.getByLabelText('Planned income')).toHaveAttribute('aria-describedby', helper.id);
  });

  it('renders the monthly-plan helper and the use-planned shortcut in Arabic', async () => {
    render(
      <AllocationMonthEditor
        locale="ar" currency="USD" categories={categories}
        initial={initial({ incomeMajorText: '500.00' })} plannedIncomeMinor="75000"
        pending={false} error={null} onCancel={vi.fn()} onSubmit={vi.fn()}
      />,
    );
    // The formatted amount contains a no-break space, which the text query
    // normalizer collapses to a plain space inside the DOM node only.
    const formatted = formatMinorAmount('75000', 'USD', 'ar').replace(/\s/g, ' ');
    expect(screen.getByText(`من الخطة الشهرية: ${formatted}. تأكيد هذا الإعداد يحدّثه.`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'استخدام الدخل المخطط' }));
    expect(screen.getByLabelText('الدخل المخطط')).toHaveValue('750.00');
    expect(screen.queryByRole('button', { name: 'استخدام الدخل المخطط' })).not.toBeInTheDocument();
  });

  it('offers "Use planned income" only while the entered income differs from the plan, and applies the plan value', async () => {
    renderEditor({ incomeMajorText: '750.00' }, { plannedIncomeMinor: '75000' });
    expect(screen.queryByRole('button', { name: 'Use planned income' })).not.toBeInTheDocument();
    const field = screen.getByLabelText('Planned income');
    await userEvent.clear(field);
    await userEvent.type(field, '900');
    await userEvent.click(screen.getByRole('button', { name: 'Use planned income' }));
    expect(field).toHaveValue('750.00');
    expect(screen.queryByRole('button', { name: 'Use planned income' })).not.toBeInTheDocument();
  });

  it('posts the submission exactly once for a double Confirm, and re-arms after the pending cycle ends', async () => {
    const onSubmit = vi.fn();
    const { rerender } = renderEditor({ incomeMajorText: '1000' }, { onSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The parent's pending cycle ends with a recoverable rejection: the editor
    // stays open, so a corrected retry must be able to post again.
    rerender(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({ incomeMajorText: '1000' })} plannedIncomeMinor={null} pending error={null} onCancel={vi.fn()} onSubmit={onSubmit} />);
    rerender(<AllocationMonthEditor locale="en" currency="USD" categories={categories} initial={initial({ incomeMajorText: '1000' })} plannedIncomeMinor={null} pending={false} error="Could not save this plan." onCancel={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
