import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, fixtures, renderWithWorkspace, space } from '../../test/harness.tsx';
import { WalletStatementDialog } from './wallet-statement.tsx';
import { ActivityScreen } from '../activity/activity.tsx';
import { AccountsScreen } from './accounts.tsx';
import { parseRoute, routeHash } from '../../app/router.ts';

const wallet = fixtures.accounts.wallets.find((w) => w.kind === 'cash' && w.currency === 'USD')!;
describe('statement comparison', () => {
  it('compares cents through a read only, isolates amounts and preselects recording', async () => {
    const api = fakeApi({ walletBalanceOn: async () => ({ walletId: wallet.id, on: '2026-09-30', currency: 'USD', balance: 10000n }) });
    const onRecord = vi.fn();
    renderWithWorkspace(<AccountsScreen onRecord={onRecord} />, api);
    await screen.findAllByText('Check against a statement');
    await userEvent.click(screen.getAllByText('Account actions')[0]!);
    await userEvent.click(screen.getAllByText('Check against a statement')[0]!);
    fireEvent.change(screen.getByLabelText('Statement date'), { target: { value: '2026-09-30' } });
    await userEvent.type(screen.getByLabelText('Statement balance'), '105.25');
    await userEvent.click(screen.getByRole('button', { name: 'Compare balances' }));
    await waitFor(() => expect(api.walletBalanceOn).toHaveBeenCalledWith(space().id, wallet.id, '2026-09-30'));
    expect(await screen.findByText('The statement has more than the app by')).toBeInTheDocument();
    expect(screen.getByText('$5.25').tagName).toBe('BDI');
    expect(screen.getByRole('link', { name: 'See this month in Activity' })).toHaveAttribute('href', `#/activity?wallet=${wallet.id}&month=2026-09`);
    for (const name of ['recordIncome', 'recordExpense', 'recordRefund', 'recordTransfer', 'recordExchange', 'recordInvestment', 'recordLoan', 'reverseEntry', 'createWallet', 'updateWallet', 'assignMoney', 'moveBillPayment', 'saveBill', 'savePlan', 'skipBill', 'unskipBill', 'setReferenceRate'] as const) expect(api[name]).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Record a missing entry' }));
    expect(onRecord).toHaveBeenCalledWith({ kind: 'expense', walletId: wallet.id });
  });
  it('accepts Arabic-Indic whole lira in RTL and refuses fractions without calling the read', async () => {
    const lbp = fixtures.accounts.wallets.find((w) => w.kind === 'cash' && w.currency === 'LBP')!;
    const api = fakeApi({ walletBalanceOn: async () => ({ walletId: lbp.id, on: space().today, currency: 'LBP', balance: 1000n }) });
    const { container } = renderWithWorkspace(<WalletStatementDialog wallet={lbp} onClose={vi.fn()} onRecord={vi.fn()} />, api, 'ar');
    const input = screen.getByLabelText('رصيد كشف الحساب');
    await userEvent.type(input, '١٥٠٠٫٥');
    await userEvent.click(screen.getByRole('button', { name: 'مقارنة الرصيدين' }));
    expect(api.walletBalanceOn).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, '١٥٠٠');
    await userEvent.click(screen.getByRole('button', { name: 'مقارنة الرصيدين' }));
    await screen.findByText('رصيد كشف الحساب أعلى من التطبيق بمقدار');
    expect(screen.getByText(/٥٠٠\sLBP/).tagName).toBe('BDI');
    expect(container.querySelector('input[name="statementBalance"]')).toHaveAttribute('dir', 'ltr');
    expect(api.recordExpense).not.toHaveBeenCalled();
  });
  it('starts Activity filtered and keeps a historical route month available in its picker', async () => {
    const api = fakeApi();
    renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} walletId={wallet.id} month="2020-06-01" />, api);
    await waitFor(() => expect(api.activity).toHaveBeenCalledWith(space().id, { limit: 30, filter: { walletId: wallet.id, month: '2020-06-01' } }));
    expect(screen.getByLabelText('Month')).toHaveValue('2020-06-01');
  });
  it('validates Activity query parameters and round trips filters', () => {
    const route = { name: 'activity' as const, walletId: wallet.id, month: '2026-09-01' };
    expect(parseRoute(routeHash(route))).toEqual(route);
    expect(parseRoute('#/activity?wallet=bad&month=2026-13')).toEqual({ name: 'activity', walletId: null, month: null });
  });
});
