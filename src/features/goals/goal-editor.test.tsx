import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalEditor } from './goal-editor.js';
import type { CommandOutcome } from './use-goals.js';

function baseProps() {
  return {
    locale: 'en' as const, mode: 'create' as const, plannedIncomeMinor: null,
    pending: false, ambiguous: false, onClose: vi.fn(), onClearAmbiguous: vi.fn(),
    onRetry: vi.fn(), onCreate: vi.fn(), onRevise: vi.fn(),
  };
}

async function clickNext() {
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
}

async function clickBack() {
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
}

describe('GoalEditor: create', () => {
  it('creates a reserve goal with a generated goal id and shows the success screen', async () => {
    const onCreate = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '1' } });
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    expect(screen.getByRole('heading', { name: 'Type' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Reserve' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'USD' })).toBeChecked();

    await clickNext(); // Type → Target
    expect(screen.getByRole('heading', { name: 'Target' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');

    await clickNext(); // Target → Contributions
    expect(screen.getByRole('heading', { name: 'Contributions' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Monthly amount' }), '500');

    await clickNext(); // Contributions → Milestones
    expect(screen.getByRole('heading', { name: 'Milestones' })).toBeInTheDocument();

    await clickNext(); // Milestones → Review
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByText('Emergency fund')).toBeInTheDocument();
    expect(screen.getByText('$6,000.00')).toBeInTheDocument();
    expect(screen.getByText('Manual monthly amount')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const call = onCreate.mock.calls[0]![0];
    expect(call.definition).toMatchObject({
      kind: 'reserve', currency: 'USD', nameEn: 'Emergency fund', targetMinor: '600000',
      contributionMode: 'manual_monthly', monthlyAmountMinor: '50000', priority: 0,
    });
    expect(call.goalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('rejects a missing name on the target step before calling the gateway', async () => {
    const onCreate = vi.fn();
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '100');
    await clickNext();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name in at least one language.');
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Target' })).toBeInTheDocument();
  });

  it('rejects an invalid target amount on the target step', async () => {
    const onCreate = vi.fn();
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Laptop');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '0');
    await clickNext();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid positive target amount.');
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Target' })).toBeInTheDocument();
  });

  it('rejects a by-deadline goal with no deadline chosen on the contributions step', async () => {
    const onCreate = vi.fn();
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Laptop');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '1000');
    await clickNext(); // Target → Contributions
    await userEvent.click(screen.getByRole('radio', { name: 'By deadline' }));
    await clickNext();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a deadline for a by-deadline goal.');
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Contributions' })).toBeInTheDocument();
  });

  it('adds an amount milestone on the milestones step and validates its threshold', async () => {
    const onCreate = vi.fn();
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');
    await clickNext(); // Target → Contributions
    await clickNext(); // Contributions → Milestones
    await userEvent.click(screen.getByRole('button', { name: 'Add amount milestone' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Milestone name (English)' }), 'Halfway');
    await clickNext();
    expect(screen.getByRole('alert')).toHaveTextContent('Every amount milestone needs a valid positive threshold.');
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Milestones' })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Amount for this milestone' }), '3000');
    await clickNext(); // Milestones → Review
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // milestone count
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0].milestones).toEqual([
      expect.objectContaining({ kind: 'amount', labelEn: 'Halfway', thresholdMinor: '300000', ordinal: 0 }),
    ]);
  });

  it('removes a milestone before submitting', async () => {
    const onCreate = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '1' } });
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Goal');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '100');
    await clickNext(); // Target → Contributions
    await clickNext(); // Contributions → Milestones
    await userEvent.click(screen.getByRole('button', { name: 'Add checklist milestone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await clickNext(); // Milestones → Review
    expect(screen.getAllByText('0')).toHaveLength(2); // priority + milestone count
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0].milestones).toEqual([]);
  });

  it('saves the planned income as the monthly amount when that source is chosen', async () => {
    const onCreate = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '1' } });
    render(<GoalEditor {...baseProps()} plannedIncomeMinor="150000" onCreate={onCreate} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');
    await clickNext(); // Target → Contributions
    await userEvent.click(screen.getByRole('radio', { name: 'Planned income' }));

    expect(screen.getByRole('radio', { name: 'Planned income' })).toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Monthly amount' })).not.toBeInTheDocument();
    expect(screen.getByText('$1,500.00')).toBeInTheDocument();
    const hint = screen.getByText('Linked from the monthly plan’s planned income.');
    expect(screen.getByRole('status')).toHaveAttribute('aria-describedby', hint.id);

    await clickNext(); // Contributions → Milestones
    await clickNext(); // Milestones → Review
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0].definition).toMatchObject({
      contributionMode: 'manual_monthly', monthlyAmountMinor: '150000',
    });
  });

  it('blocks the planned-income source with a hint when the plan has none set', async () => {
    render(<GoalEditor {...baseProps()} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');
    await clickNext(); // Target → Contributions
    const planned = screen.getByRole('radio', { name: 'Planned income' });
    expect(planned).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Custom amount' })).toBeChecked();
    const hint = screen.getByText('Set planned income for USD in the Plan section first.');
    expect(planned).toHaveAttribute('aria-describedby', hint.id);
  });

  it('falls back to a custom amount when the currency changes after linking', async () => {
    render(<GoalEditor {...baseProps()} plannedIncomeMinor="150000" />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');
    await clickNext(); // Target → Contributions
    await userEvent.click(screen.getByRole('radio', { name: 'Planned income' }));
    expect(screen.getByRole('radio', { name: 'Planned income' })).toBeChecked();

    await clickBack(); // Contributions → Target
    await clickBack(); // Target → Type
    await userEvent.click(screen.getByRole('radio', { name: 'LBP' }));
    await clickNext(); // Type → Target
    await clickNext(); // Target → Contributions
    expect(screen.getByRole('radio', { name: 'Custom amount' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Monthly amount' })).toBeInTheDocument();
  });

  it('renders the amount-source choice and linked hint in Arabic', async () => {
    render(<GoalEditor {...baseProps()} locale="ar" plannedIncomeMinor="150000" />);
    await userEvent.click(screen.getByRole('button', { name: 'التالي' })); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'الاسم (إنجليزي)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'مبلغ الهدف' }), '6000');
    await userEvent.click(screen.getByRole('button', { name: 'التالي' })); // Target → Contributions
    expect(screen.getByRole('radio', { name: 'مبلغ مخصص' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'الدخل المخطط' })).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'الدخل المخطط' }));
    expect(screen.queryByRole('textbox', { name: 'المبلغ الشهري' })).not.toBeInTheDocument();
    expect(screen.getByText('مرتبط بالدخل المخطط في الخطة الشهرية.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('USD');
  });

  it('renders the blocked planned-income hint in Arabic', async () => {
    render(<GoalEditor {...baseProps()} locale="ar" />);
    await userEvent.click(screen.getByRole('button', { name: 'التالي' })); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'الاسم (إنجليزي)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'مبلغ الهدف' }), '6000');
    await userEvent.click(screen.getByRole('button', { name: 'التالي' })); // Target → Contributions
    expect(screen.getByRole('radio', { name: 'الدخل المخطط' })).toBeDisabled();
    expect(screen.getByText('حدد الدخل المخطط لعملة USD في قسم الخطة أولًا.')).toBeInTheDocument();
  });

  it('invokes onCreate exactly once when Save is clicked twice while the first call is still in flight', async () => {
    let resolveCreate!: (outcome: CommandOutcome) => void;
    const onCreate = vi.fn(() => new Promise<CommandOutcome>((resolve) => { resolveCreate = resolve; }));
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await clickNext(); // Type → Target
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');
    await clickNext(); // → Contributions
    await userEvent.type(screen.getByRole('textbox', { name: 'Monthly amount' }), '500');
    await clickNext(); // → Milestones
    await clickNext(); // → Review
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(saveButton);
    expect(onCreate).toHaveBeenCalledTimes(1);
    await userEvent.click(saveButton);
    expect(onCreate).toHaveBeenCalledTimes(1);
    resolveCreate({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '1' } });
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});

describe('GoalEditor: revise', () => {
  const existing = {
    goalId: 'g1', expectedRevisionId: '3', currentState: 'active' as const,
    definition: {
      kind: 'reserve' as const, currency: 'USD' as const, nameEn: 'Emergency fund', nameAr: null, note: null,
      targetMinor: '600000', deadline: null, contributionMode: 'manual_monthly' as const, monthlyAmountMinor: '50000', priority: 0,
    },
    milestones: [],
  };

  async function walkToReview() {
    for (let index = 0; index < 4; index += 1) await clickNext();
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
  }

  it('locks kind and currency and keeps the revise warning on the type step', () => {
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} />);
    expect(screen.getByRole('radio', { name: 'Reserve' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'USD' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The note and monthly base amount aren’t shown here yet');
  });

  it('revises with the existing goal id and expected revision id', async () => {
    const onRevise = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '4' } });
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} onRevise={onRevise} />);
    await clickNext(); // Type → Target
    await userEvent.clear(screen.getByRole('textbox', { name: 'Target amount' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '7000');
    await clickNext(); // Target → Contributions
    await clickNext(); // Contributions → Milestones
    await clickNext(); // Milestones → Review
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'g1', expectedRevisionId: '3', state: 'active', definition: expect.objectContaining({ targetMinor: '700000' }),
    })));
  });

  it('pre-selects the requested state for a one-click-feeling pause action', async () => {
    const onRevise = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '4' } });
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} initialState="paused" onRevise={onRevise} />);
    expect(screen.getByRole('radio', { name: 'Paused' })).toBeChecked();
    await walkToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledWith(expect.objectContaining({ state: 'paused' })));
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { goalId: 'g1', revisionId: '4' } });
    const onRevise = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} ambiguous onRetry={onRetry} onRevise={onRevise} />);
    await walkToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it('disables the form while pending', async () => {
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} pending />);
    await walkToReview();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('pre-selects the planned-income source when the existing amount matches the planned income', async () => {
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} plannedIncomeMinor="50000" />);
    await clickNext(); // Type → Target
    await clickNext(); // Target → Contributions
    expect(screen.getByRole('radio', { name: 'Planned income' })).toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Monthly amount' })).not.toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
  });

  it('defaults to a custom amount in revise mode when the data does not support the planned-income link', async () => {
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} plannedIncomeMinor="99900" />);
    await clickNext(); // Type → Target
    await clickNext(); // Target → Contributions
    expect(screen.getByRole('radio', { name: 'Custom amount' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Monthly amount' })).toHaveValue('500');
  });
});
