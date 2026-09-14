import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleEditor } from './schedule-editor.js';

const LOAN_ID = '00000000-0000-4000-8000-000000000901';

function baseProps() {
  return {
    locale: 'en' as const, pending: false, ambiguous: false,
    onClose: vi.fn(), onClearAmbiguous: vi.fn(), onRetry: vi.fn(), onSave: vi.fn(),
  };
}

async function fillMinimalValidForm(form: HTMLElement) {
  await userEvent.type(within(form).getByRole('textbox', { name: 'Name (English)' }), 'Rent');
  await userEvent.type(within(form).getByRole('textbox', { name: 'Expected amount' }), '500');
  const startsOn = within(form).getByLabelText('Starts on');
  await userEvent.clear(startsOn);
  await userEvent.type(startsOn, '2026-10-01');
}

describe('ScheduleEditor', () => {
  it('creates a monthly expense schedule with the exact reviewable definition', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { scheduleId: 's1', revisionId: '1' } });
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await fillMinimalValidForm(form);
    expect(screen.getByText('$500.00')).toBeInTheDocument(); // reviewable preview before submit
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith({
      scheduleId: expect.any(String),
      expectedRevisionId: null,
      definition: {
        currency: 'USD', kind: 'expense', state: 'active', nameEn: 'Rent', nameAr: null,
        expectedMinor: '50000', startsOn: '2026-10-01', endsOn: null, cadence: 'monthly', intervalCount: 1,
        categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null,
      },
    });
  });

  it('supports weekly cadence, an end date, and reference ids', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { scheduleId: 's1', revisionId: '1' } });
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Income' }));
    await userEvent.click(within(form).getByRole('radio', { name: 'Weekly' }));
    await fillMinimalValidForm(form);
    const endsOn = within(form).getByLabelText('Ends on (optional)');
    await userEvent.type(endsOn, '2027-01-01');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Funding goal id' }), '00000000-0000-4000-8000-000000000801');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({
        kind: 'income', cadence: 'weekly', endsOn: '2027-01-01', fundingGoalId: '00000000-0000-4000-8000-000000000801',
      }),
    }));
  });

  it('rejects a blank name before calling the gateway', async () => {
    const onSave = vi.fn();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Expected amount' }), '500');
    const startsOn = within(form).getByLabelText('Starts on');
    await userEvent.clear(startsOn);
    await userEvent.type(startsOn, '2026-10-01');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name in at least one language.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a debt payment schedule with no loan reference, and accepts one with it', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { scheduleId: 's1', revisionId: '1' } });
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Debt payment' }));
    await fillMinimalValidForm(form);
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A debt payment schedule needs a loan reference id.');
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.type(within(form).getByRole('textbox', { name: 'Loan id' }), LOAN_ID);
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ definition: expect.objectContaining({ kind: 'debt_payment', loanId: LOAN_ID }) }));
  });

  it('rejects an invalid reference id, preserving the amount already entered', async () => {
    const onSave = vi.fn();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await fillMinimalValidForm(form);
    await userEvent.type(within(form).getByRole('textbox', { name: 'Category id' }), 'not-a-uuid');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(within(form).getByRole('textbox', { name: 'Expected amount' })).toHaveValue('500');
  });

  it('the repeat-interval field\'s own min/max blocks submitting an out-of-range value before onSave is ever reached', async () => {
    // The input carries `min={1} max={99}` -- jsdom (like a real browser)
    // enforces HTML5 constraint validation on a native `type="number"`
    // submit, so an out-of-range value never reaches the JS `submit`
    // handler at all here; `ScheduleEditor`'s own `1..99` check is a
    // defense-in-depth backup for a non-browser caller, not something a
    // real click-through can exercise once the browser already refuses.
    const onSave = vi.fn();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await fillMinimalValidForm(form);
    const interval = within(form).getByRole('spinbutton', { name: 'Repeat every N cadence units' }) as HTMLInputElement;
    await userEvent.clear(interval);
    await userEvent.type(interval, '0');
    expect(interval.validity.valid).toBe(false);
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { scheduleId: 's1', revisionId: '1' } });
    const onSave = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<ScheduleEditor {...baseProps()} ambiguous onRetry={onRetry} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await fillMinimalValidForm(form);
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the form while pending', () => {
    render(<ScheduleEditor {...baseProps()} pending />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
