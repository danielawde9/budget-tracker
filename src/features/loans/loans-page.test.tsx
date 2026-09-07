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
});
