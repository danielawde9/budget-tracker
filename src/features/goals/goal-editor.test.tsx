import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalEditor } from './goal-editor.js';

function baseProps() {
  return {
    locale: 'en' as const, mode: 'create' as const,
    pending: false, ambiguous: false, onClose: vi.fn(), onClearAmbiguous: vi.fn(),
    onRetry: vi.fn(), onCreate: vi.fn(), onRevise: vi.fn(),
  };
}

describe('GoalEditor: create', () => {
  it('creates a reserve goal with a generated goal id and shows the success screen', async () => {
    const onCreate = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '1' } });
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');
    await userEvent.type(screen.getByRole('textbox', { name: 'Monthly amount' }), '500');
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

  it('rejects a missing name before calling the gateway', async () => {
    const onCreate = vi.fn();
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name in at least one language.');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('rejects a by-deadline goal with no deadline chosen', async () => {
    const onCreate = vi.fn();
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Laptop');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '1000');
    await userEvent.click(screen.getByRole('radio', { name: 'By deadline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a deadline for a by-deadline goal.');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('adds an amount milestone and validates its threshold', async () => {
    const onCreate = vi.fn();
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Emergency fund');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '6000');
    await userEvent.click(screen.getByRole('button', { name: 'Add amount milestone' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Milestone name (English)' }), 'Halfway');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Every amount milestone needs a valid positive threshold.');
    expect(onCreate).not.toHaveBeenCalled();

    await userEvent.type(screen.getByRole('textbox', { name: 'Amount for this milestone' }), '3000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0].milestones).toEqual([
      expect.objectContaining({ kind: 'amount', labelEn: 'Halfway', thresholdMinor: '300000', ordinal: 0 }),
    ]);
  });

  it('removes a milestone before submitting', async () => {
    const onCreate = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '1' } });
    render(<GoalEditor {...baseProps()} onCreate={onCreate} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Goal');
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Add checklist milestone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0].milestones).toEqual([]);
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

  it('locks kind and currency', () => {
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} />);
    expect(screen.getByRole('radio', { name: 'Reserve' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'USD' })).toBeDisabled();
  });

  it('revises with the existing goal id and expected revision id', async () => {
    const onRevise = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '4' } });
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} onRevise={onRevise} />);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Target amount' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Target amount' }), '7000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'g1', expectedRevisionId: '3', state: 'active', definition: expect.objectContaining({ targetMinor: '700000' }),
    })));
  });

  it('pre-selects the requested state for a one-click-feeling pause action', async () => {
    const onRevise = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { goalId: 'g1', revisionId: '4' } });
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} initialState="paused" onRevise={onRevise} />);
    expect(screen.getByRole('radio', { name: 'Paused' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalledWith(expect.objectContaining({ state: 'paused' })));
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { goalId: 'g1', revisionId: '4' } });
    const onRevise = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} ambiguous onRetry={onRetry} onRevise={onRevise} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it('disables the form while pending', () => {
    render(<GoalEditor {...baseProps()} mode="revise" existing={existing} pending />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
