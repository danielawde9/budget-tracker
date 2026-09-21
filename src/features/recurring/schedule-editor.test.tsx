import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleEditor } from './schedule-editor.js';
import type { CommandOutcome } from './use-recurring.js';

const LOAN_ID = '00000000-0000-4000-8000-000000000901';
const GOAL_ID = '00000000-0000-4000-8000-000000000801';
const CATEGORY_ID = '00000000-0000-4000-8000-000000000701';
const WALLET_ID = '00000000-0000-4000-8000-000000000601';

function referenceOptions() {
  return {
    categories: [{ id: CATEGORY_ID, nameEn: 'Utilities', nameAr: 'مرافق' }],
    loans: [{ id: LOAN_ID, name: 'Maya' }],
    goals: [{ id: GOAL_ID, nameEn: 'Emergency fund', nameAr: 'صندوق الطوارئ' }],
    wallets: [{ id: WALLET_ID, name: 'Daily USD', currency: 'USD' }],
  };
}

function baseProps() {
  return {
    locale: 'en' as const, pending: false, ambiguous: false,
    referenceOptions: referenceOptions(),
    plannedIncomeByCurrency: { USD: null, LBP: null } as const,
    onClose: vi.fn(), onClearAmbiguous: vi.fn(), onRetry: vi.fn(), onSave: vi.fn(),
  };
}

function successSave() {
  return vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { scheduleId: 's1', revisionId: '1' } });
}

async function clickNext(form: HTMLElement) {
  await userEvent.click(within(form).getByRole('button', { name: 'Next' }));
}

async function clickBack(form: HTMLElement) {
  await userEvent.click(within(form).getByRole('button', { name: 'Back' }));
}

async function fillAmount(form: HTMLElement, amount = '500') {
  await userEvent.type(within(form).getByRole('textbox', { name: 'Expected amount' }), amount);
}

/** The Details-step gates: a name plus a valid start date. */
async function fillDetails(form: HTMLElement, name = 'Rent') {
  await userEvent.type(within(form).getByRole('textbox', { name: 'Name (English)' }), name);
  const startsOn = within(form).getByLabelText('Starts on');
  await userEvent.clear(startsOn);
  await userEvent.type(startsOn, '2026-10-01');
}

/** Walk Next from the Review-bound path: Amount → Details → References → Review. */
async function walkToReview(form: HTMLElement) {
  await clickNext(form); // Type → Amount
  await fillAmount(form);
  await clickNext(form); // → Details
  await fillDetails(form);
  await clickNext(form); // → References
  await clickNext(form); // → Review
}

describe('ScheduleEditor', () => {
  it('creates a monthly expense schedule with the exact reviewable definition', async () => {
    const onSave = successSave();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    expect(screen.getByRole('dialog', { name: 'New schedule' })).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Schedule details' });

    // The indicator lists every step on entry, in order; Type is current and
    // its fields are grouped under it.
    expect([...form.querySelectorAll('.cr-wizard-step-label')].map((el) => el.textContent))
      .toEqual(['Type', 'Amount', 'Details', 'References', 'Review']);
    expect(within(form).getByRole('group', { name: 'Type' })).toBeInTheDocument();
    expect(within(form).queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    await walkToReview(form);

    expect(within(form).getByRole('group', { name: 'Review' })).toBeInTheDocument();
    expect(within(form).getByText('Expense (bill)')).toBeInTheDocument(); // Kind row value
    expect(within(form).getByText('USD')).toBeInTheDocument(); // Currency row value
    expect(within(form).getByText('Active')).toBeInTheDocument(); // State row value
    expect(within(form).getByText('$500.00')).toBeInTheDocument(); // review amount before saving
    expect(within(form).getByText('Monthly · 1 months')).toBeInTheDocument(); // cadence + interval
    expect(within(form).getByText('2026-10-01')).toBeInTheDocument(); // starts
    expect(within(form).getByText('—')).toBeInTheDocument(); // empty ends
    expect(within(form).getByText('Rent')).toBeInTheDocument(); // name
    expect(within(form).getAllByText('None')).toHaveLength(4); // category, loan, goal, wallet

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

  it('supports weekly cadence, an end date, and reference dropdowns that submit the chosen ids', async () => {
    const onSave = successSave();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Income' }));
    await clickNext(form); // → Amount (income keeps the amount-source choice)
    await fillAmount(form);
    await clickNext(form); // → Details
    await userEvent.click(within(form).getByRole('radio', { name: 'Weekly' }));
    await fillDetails(form);
    const endsOn = within(form).getByLabelText('Ends on (optional)');
    await userEvent.type(endsOn, '2027-01-01');
    await clickNext(form); // → References
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Funding goal' }), GOAL_ID);
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Category' }), CATEGORY_ID);
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Preferred wallet' }), WALLET_ID);
    await clickNext(form); // → Review
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({
        kind: 'income', cadence: 'weekly', endsOn: '2027-01-01',
        fundingGoalId: GOAL_ID, categoryId: CATEGORY_ID, preferredWalletId: WALLET_ID,
      }),
    }));
  });

  it('keeps entered values when stepping Back and re-entering a step', async () => {
    render(<ScheduleEditor {...baseProps()} onSave={vi.fn()} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Paused' }));
    await clickNext(form); // → Amount
    expect(within(form).queryByRole('radio', { name: 'Paused' })).not.toBeInTheDocument();
    await clickBack(form); // → Type
    expect(within(form).getByRole('radio', { name: 'Paused' })).toBeChecked();
    await clickNext(form); // → Amount
    expect(within(form).getByRole('textbox', { name: 'Expected amount' })).toBeInTheDocument();
  });

  it('rejects a blank name on the Details step before calling the gateway', async () => {
    const onSave = vi.fn();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await clickNext(form); // → Amount
    await fillAmount(form);
    await clickNext(form); // → Details
    const startsOn = within(form).getByLabelText('Starts on');
    await userEvent.clear(startsOn);
    await userEvent.type(startsOn, '2026-10-01');
    await clickNext(form); // blocked: no name
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name in at least one language.');
    expect(onSave).not.toHaveBeenCalled();
    // Still on Details -- fill the name and the same Next now passes.
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name (English)' }), 'Rent');
    await clickNext(form);
    expect(within(form).getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
  });

  it('blocks the Details step with an out-of-range repeat interval', async () => {
    const onSave = vi.fn();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await clickNext(form); // → Amount
    await fillAmount(form);
    await clickNext(form); // → Details
    await fillDetails(form);
    const interval = within(form).getByRole('spinbutton', { name: 'Repeat every' });
    await userEvent.clear(interval);
    await userEvent.type(interval, '0');
    await clickNext(form); // blocked by the interval gate
    expect(screen.getByRole('alert')).toHaveTextContent('The repeat interval must be a whole number from 1 to 99.');
    expect(onSave).not.toHaveBeenCalled();
    expect(within(form).getByRole('spinbutton', { name: 'Repeat every' })).toBeInTheDocument();
    await userEvent.clear(interval);
    await userEvent.type(interval, '2');
    await clickNext(form); // → References
    expect(within(form).getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects a debt payment schedule with no loan selected, and accepts one with a loan chosen from the dropdown', async () => {
    const onSave = successSave();
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Debt payment' }));
    await clickNext(form); // → Amount
    await fillAmount(form);
    await clickNext(form); // → Details
    await fillDetails(form);
    await clickNext(form); // → References
    await clickNext(form); // blocked: debt payment needs a loan
    expect(screen.getByRole('alert')).toHaveTextContent('Select the loan this payment covers');
    expect(onSave).not.toHaveBeenCalled();
    expect(within(form).getByRole('combobox', { name: 'Loan' })).toBeInTheDocument();

    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Loan' }), LOAN_ID);
    await clickNext(form); // → Review
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ definition: expect.objectContaining({ kind: 'debt_payment', loanId: LOAN_ID }) }));
  });

  it('points to the Loans section when a debt payment has no loan to pick yet', async () => {
    render(<ScheduleEditor {...baseProps()} referenceOptions={{ ...referenceOptions(), loans: [] }} onSave={vi.fn()} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Debt payment' }));
    await clickNext(form); // → Amount
    await fillAmount(form);
    await clickNext(form); // → Details
    await fillDetails(form);
    await clickNext(form); // → References
    expect(within(form).getByText('Add a loan in the Loans section first.')).toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: 'Loan' })).toHaveAccessibleDescription('Add a loan in the Loans section first.');
  });

  it('saves the planned income amount when the planned source is chosen for an income schedule', async () => {
    const onSave = successSave();
    render(<ScheduleEditor {...baseProps()} plannedIncomeByCurrency={{ USD: '250000', LBP: null }} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Income' }));
    await clickNext(form); // → Amount
    await userEvent.click(within(form).getByRole('radio', { name: 'Planned income' }));

    // The free amount input is replaced by the read-only planned summary.
    expect(within(form).queryByRole('textbox', { name: 'Expected amount' })).not.toBeInTheDocument();
    expect(within(form).getByText('$2,500.00')).toBeInTheDocument();
    expect(within(form).getByText('From the planned income for USD in the monthly plan.')).toBeInTheDocument();

    await clickNext(form); // → Details
    await fillDetails(form, 'Salary');
    await clickNext(form); // → References
    await clickNext(form); // → Review
    expect(within(form).getByText('$2,500.00')).toBeInTheDocument(); // review amount row
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ kind: 'income', currency: 'USD', expectedMinor: '250000' }),
    }));
  });

  it('falls back to a custom amount when the selected currency has no planned income', async () => {
    render(<ScheduleEditor {...baseProps()} plannedIncomeByCurrency={{ USD: '250000', LBP: null }} onSave={vi.fn()} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Income' }));
    await clickNext(form); // → Amount
    await userEvent.click(within(form).getByRole('radio', { name: 'Planned income' }));
    expect(within(form).getByRole('radio', { name: 'Planned income' })).toBeChecked();

    // Back on Type: switching to a currency with no planned income re-evaluates
    // the source: back to custom, with the hint visible.
    await clickBack(form);
    await userEvent.click(within(form).getByRole('radio', { name: 'LBP' }));
    await clickNext(form); // → Amount
    expect(within(form).getByRole('radio', { name: 'Planned income' })).toBeDisabled();
    expect(within(form).getByRole('radio', { name: 'Custom amount' })).toBeChecked();
    expect(within(form).getByText('Set planned income for LBP in the Plan section first.')).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Expected amount' })).toBeInTheDocument();
  });

  it('keeps the planned-income choice disabled until planned income is set for the currency', async () => {
    render(<ScheduleEditor {...baseProps()} onSave={vi.fn()} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Income' }));
    await clickNext(form); // → Amount
    expect(within(form).getByRole('radio', { name: 'Planned income' })).toBeDisabled();
    expect(within(form).getByText('Set planned income for USD in the Plan section first.')).toBeInTheDocument();
  });

  it('renders the wizard chrome and reference dropdowns in Arabic', async () => {
    render(<ScheduleEditor {...baseProps()} locale="ar" />);
    const form = screen.getByRole('form', { name: 'تفاصيل الجدول' });
    // Bilingual step indicator, always showing all five steps, in order.
    expect([...form.querySelectorAll('.cr-wizard-step-label')].map((el) => el.textContent))
      .toEqual(['النوع', 'المبلغ', 'التفاصيل', 'المراجع', 'مراجعة']);
    await userEvent.click(within(form).getByRole('radio', { name: 'دخل' }));
    await userEvent.click(within(form).getByRole('button', { name: 'التالي' })); // → Amount
    expect(within(form).getByRole('group', { name: 'المبلغ' })).toBeInTheDocument();
    expect(within(form).getByRole('radio', { name: 'الدخل المخطط' })).toBeInTheDocument();
    expect(within(form).getByText('حدّد الدخل المخطط لعملة USD في قسم الخطة أولًا.')).toBeInTheDocument();
    await userEvent.type(within(form).getByRole('textbox', { name: 'المبلغ المتوقع' }), '500');
    await userEvent.click(within(form).getByRole('button', { name: 'التالي' })); // → Details
    await userEvent.type(within(form).getByRole('textbox', { name: 'الاسم (إنجليزي)' }), 'إيجار');
    const startsOn = within(form).getByLabelText('يبدأ في');
    await userEvent.clear(startsOn);
    await userEvent.type(startsOn, '2026-10-01');
    await userEvent.click(within(form).getByRole('button', { name: 'التالي' })); // → References
    expect(within(form).getByRole('combobox', { name: 'الفئة' })).toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: 'القرض' })).toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: 'هدف التمويل' })).toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: 'المحفظة المفضّلة' })).toBeInTheDocument();
    expect(within(form).getByRole('option', { name: 'مرافق' })).toBeInTheDocument();
    expect(within(form).getByRole('option', { name: 'صندوق الطوارئ' })).toBeInTheDocument();
  });

  it('offers an unchanged retry when ambiguous', async () => {
    const onRetry = vi.fn().mockResolvedValue({ status: 'success', reconciled: true, result: { scheduleId: 's1', revisionId: '1' } });
    const onSave = vi.fn().mockRejectedValue(new Error('network timeout'));
    render(<ScheduleEditor {...baseProps()} ambiguous onRetry={onRetry} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await walkToReview(form);
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry unchanged request' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the form while pending', async () => {
    const onSave = successSave();
    const { rerender } = render(<ScheduleEditor {...baseProps()} pending onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    rerender(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await walkToReview(form);

    rerender(<ScheduleEditor {...baseProps()} pending onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('invokes onSave exactly once when Save is clicked twice while the first call is still in flight', async () => {
    let resolveSave!: (outcome: CommandOutcome) => void;
    const onSave = vi.fn(() => new Promise<CommandOutcome>((resolve) => { resolveSave = resolve; }));
    render(<ScheduleEditor {...baseProps()} onSave={onSave} />);
    const form = screen.getByRole('form', { name: 'Schedule details' });
    await walkToReview(form);
    const saveButton = within(form).getByRole('button', { name: 'Save' });
    await userEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
    await userEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
    resolveSave({ status: 'success', reconciled: false, result: { scheduleId: 's1', revisionId: '1' } });
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
