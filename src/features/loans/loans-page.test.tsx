import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LoansPage } from './loans-page.js';
import { InMemoryLoansGateway } from '../../test/in-memory-loans-gateway.js';

async function renderPage(gateway = new InMemoryLoansGateway()) {
  const user = userEvent.setup();
  render(<LoansPage gateway={gateway} />);
  await screen.findByText('Maya');
  return { gateway, user };
}

describe('LoansPage', () => {
  it('shows per-currency totals and both loan directions without combining currencies', async () => {
    await renderPage();

    const usd = screen.getByTestId('summary-USD');
    expect(within(within(usd).getByText('Owed to me').parentElement as HTMLElement).getByText('$750.00')).toBeInTheDocument();
    expect(within(within(usd).getByText('I owe').parentElement as HTMLElement).getByText('$1,200.00')).toBeInTheDocument();
    expect(within(usd).getByText('$500.00')).toBeInTheDocument();
    expect(within(usd).getByText('$200.00')).toBeInTheDocument();
    expect(within(usd).getByText('$300.00')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'They owe me' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'I owe them' })).toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Settled')).toBeInTheDocument();
    expect(screen.queryByText(/grand total/i)).not.toBeInTheDocument();
  });

  it('switches the complete workspace to Arabic RTL', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'العربية' }));

    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1, name: 'القروض' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getAllByText('USD')[0]?.closest('bdi')).not.toBeNull();
  });

  it('switches between personal and household spaces and reloads projections', async () => {
    const { gateway, user } = await renderPage();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Space' }), 'household-space');

    await screen.findByText('Home budget');
    expect(gateway.calls).toContainEqual({
      name: 'loadDashboard',
      input: { spaceId: 'household-space', month: expect.stringMatching(/^\d{4}-\d{2}-01$/) },
    });
    expect(screen.getByText('Household space')).toBeInTheDocument();
  });

  it('creates opening, lending, and borrowing loans through the gateway', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a loan' });
    await user.click(within(dialog).getByRole('radio', { name: 'Opening outstanding' }));
    await user.type(within(dialog).getByLabelText('Person'), 'Nour');
    await user.type(within(dialog).getByLabelText('Amount'), '90.50');
    await user.click(within(dialog).getByRole('button', { name: 'Record opening' }));

    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'createLoan')).toBe(true));
    const creation = gateway.calls.find((call) => call.name === 'createLoan')?.input;
    expect(creation).toMatchObject({
      mode: 'opening', direction: 'they_owe_me', amountMinor: '9050',
    });
    expect(creation).not.toHaveProperty('walletId');

    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    const lendingDialog = screen.getByRole('dialog', { name: 'Add a loan' });
    await user.click(within(lendingDialog).getByRole('radio', { name: 'I lent money' }));
    await user.type(within(lendingDialog).getByLabelText('Person'), 'Jad');
    await user.type(within(lendingDialog).getByLabelText('Amount'), '120');
    await user.click(within(lendingDialog).getByRole('button', { name: 'Record lending' }));

    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    const borrowingDialog = screen.getByRole('dialog', { name: 'Add a loan' });
    await user.click(within(borrowingDialog).getByRole('radio', { name: 'I borrowed money' }));
    await user.type(within(borrowingDialog).getByLabelText('Person'), 'Lina');
    await user.type(within(borrowingDialog).getByLabelText('Amount'), '80');
    await user.click(within(borrowingDialog).getByRole('button', { name: 'Record borrowing' }));

    const creations = gateway.calls.filter((call) => call.name === 'createLoan').map((call) => call.input);
    expect(creations[1]).toMatchObject({ mode: 'cash', direction: 'they_owe_me', walletId: 'usd-wallet', amountMinor: '12000' });
    expect(creations[2]).toMatchObject({ mode: 'cash', direction: 'i_owe_them', walletId: 'usd-wallet', amountMinor: '8000' });
  });

  it('records partial or full repayment with a same-currency wallet', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Open Maya loan' }));
    await user.click(screen.getByRole('button', { name: 'Receive repayment' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive repayment from Maya' });
    expect(within(dialog).queryByRole('option', { name: 'Home LBP' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Use full remaining amount' }));
    await user.click(within(dialog).getByRole('button', { name: 'Receive $750.00' }));

    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'recordRepayment')).toBe(true));
    expect(gateway.calls.find((call) => call.name === 'recordRepayment')?.input).toMatchObject({
      loanId: 'maya-loan', walletId: 'usd-wallet', amountMinor: '75000',
    });
  });

  it('keeps monthly target, paid, reservation, and due amounts separate', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Open Karim loan' }));
    const detail = screen.getByRole('dialog', { name: 'Karim loan details' });
    expect(within(detail).getByText('Monthly target')).toBeInTheDocument();
    expect(within(detail).getByText('Paid this month')).toBeInTheDocument();
    expect(within(detail).getByText('Still reserved')).toBeInTheDocument();
    expect(within(detail).getByText('Due amount')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Change monthly target' }));
    const target = screen.getByRole('dialog', { name: 'Monthly target for Karim' });
    await user.clear(within(target).getByLabelText('Target amount'));
    await user.type(within(target).getByLabelText('Target amount'), '400');
    await user.click(within(target).getByRole('button', { name: 'Save target' }));

    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'setMonthlyTarget')).toBe(true));
    expect(gateway.calls.find((call) => call.name === 'setMonthlyTarget')?.input).toMatchObject({ targetMinor: '40000' });
  });

  it('clears a monthly target with zero and rejects a target above outstanding', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Open Karim loan' }));
    await user.click(screen.getByRole('button', { name: 'Change monthly target' }));
    let target = screen.getByRole('dialog', { name: 'Monthly target for Karim' });
    const input = within(target).getByLabelText('Target amount');
    await user.clear(input);
    await user.type(input, '1300');
    await user.click(within(target).getByRole('button', { name: 'Save target' }));
    expect(await within(target).findByText('Target is above the remaining loan')).toBeInTheDocument();
    expect(gateway.calls.some((call) => call.name === 'setMonthlyTarget')).toBe(false);

    await user.clear(input);
    await user.type(input, '0');
    await user.click(within(target).getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'setMonthlyTarget')).toBe(true));
    expect(gateway.calls.find((call) => call.name === 'setMonthlyTarget')?.input).toMatchObject({ targetMinor: '0' });
  });

  it('records a partial repayment and restores trigger focus after Escape', async () => {
    const { gateway, user } = await renderPage();
    const addLoan = screen.getByRole('button', { name: 'Add loan' });
    await user.click(addLoan);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Add a loan' })).not.toBeInTheDocument();
    expect(addLoan).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Open Maya loan' }));
    await user.click(screen.getByRole('button', { name: 'Receive repayment' }));
    const repayment = screen.getByRole('dialog', { name: 'Receive repayment from Maya' });
    await user.type(within(repayment).getByLabelText('Repayment amount'), '25');
    await user.click(within(repayment).getByRole('button', { name: 'Receive $25.00' }));
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'recordRepayment')).toBe(true));
    expect(gateway.calls.find((call) => call.name === 'recordRepayment')?.input).toMatchObject({ amountMinor: '2500' });
  });

  it('explains dependent repayment rejection and preserves correction recovery', async () => {
    const gateway = new InMemoryLoansGateway();
    const { user } = await renderPage(gateway);
    await user.click(screen.getByRole('button', { name: 'Open Maya loan' }));
    await user.click(screen.getByRole('button', { name: 'Correct lending entry from Jul 1, 2026' }));
    const correction = screen.getByRole('dialog', { name: 'Correct this ledger entry' });
    await user.click(within(correction).getByRole('checkbox', { name: 'I understand this adds a reversal' }));
    gateway.error = new Error('the correction would invalidate dependent repayments');
    await user.click(within(correction).getByRole('button', { name: 'Add reversal' }));

    expect(await within(correction).findByText('Later repayments depend on this entry')).toBeInTheDocument();
    expect(within(correction).getByText('Reverse the later repayments first, then retry this correction.')).toBeInTheDocument();
    expect(within(correction).getByRole('button', { name: 'Add reversal' })).toBeInTheDocument();
  });

  it('shows membership failure with a clear space recovery action', async () => {
    const gateway = new InMemoryLoansGateway();
    gateway.error = new Error('an active space membership is required');
    render(<LoansPage gateway={gateway} />);

    expect(await screen.findByText('You no longer have access to this space')).toBeInTheDocument();
    expect(screen.getByText('Switch spaces or ask a household manager to restore your membership.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('translates creation fields in Arabic and keeps keyboard focus inside the overlay', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'العربية' }));
    await user.click(screen.getByRole('button', { name: 'إضافة قرض' }));
    const dialog = screen.getByRole('dialog', { name: 'إضافة قرض' });

    expect(within(dialog).getByLabelText('الشخص')).toBeInTheDocument();
    const close = within(dialog).getByRole('button', { name: 'إغلاق' });
    close.focus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('keeps an overpayment visible and never changes the displayed ledger balance', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Open Maya loan' }));
    await user.click(screen.getByRole('button', { name: 'Receive repayment' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive repayment from Maya' });
    await user.type(within(dialog).getByLabelText('Repayment amount'), '800');
    await user.click(within(dialog).getByRole('button', { name: 'Receive $800.00' }));

    expect(await within(dialog).findByText('Amount is above the remaining loan')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('800')).toBeInTheDocument();
    expect(gateway.calls.some((call) => call.name === 'recordRepayment')).toBe(false);
  });

  it.each([
    ['the wallet must be active, in the requested space, and in the loan currency', 'Choose a matching wallet'],
    ['request ID was already used with different data', 'This request changed during retry'],
    ['The database rejected this effective date.', 'The change was not recorded'],
  ])('shows recoverable database rejection: %s', async (message, title) => {
    const gateway = new InMemoryLoansGateway();
    const { user } = await renderPage(gateway);
    await user.click(screen.getByRole('button', { name: 'Open Maya loan' }));
    await user.click(screen.getByRole('button', { name: 'Receive repayment' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive repayment from Maya' });
    await user.type(within(dialog).getByLabelText('Repayment amount'), '10');
    gateway.error = new Error(message);
    await user.click(within(dialog).getByRole('button', { name: 'Receive $10.00' }));

    expect(await within(dialog).findByText(title)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('10')).toBeInTheDocument();
  });

  it('reuses a request ID for an unchanged retry and rotates it after input changes', async () => {
    const gateway = new InMemoryLoansGateway();
    const { user } = await renderPage(gateway);
    await user.click(screen.getByRole('button', { name: 'Open Maya loan' }));
    await user.click(screen.getByRole('button', { name: 'Receive repayment' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive repayment from Maya' });
    const amount = within(dialog).getByLabelText('Repayment amount');
    await user.type(amount, '10');
    gateway.error = new Error('Network request failed');
    await user.click(within(dialog).getByRole('button', { name: 'Receive $10.00' }));
    await within(dialog).findByText('The change was not recorded');
    await user.click(within(dialog).getByRole('button', { name: 'Receive $10.00' }));
    await user.clear(amount);
    await user.type(amount, '20');
    await user.click(within(dialog).getByRole('button', { name: 'Receive $20.00' }));

    const attempts = gateway.calls.filter((call) => call.name === 'recordRepayment').map((call) => call.input as { requestId: string });
    expect(attempts[0]?.requestId).toBe(attempts[1]?.requestId);
    expect(attempts[2]?.requestId).not.toBe(attempts[1]?.requestId);
  });
});
