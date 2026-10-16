import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, itemId, renderWithWorkspace, space } from '../test/harness.tsx';
import { RecordDialog } from './record-dialog.tsx';

it('adds missing opening money to the selected account through the opening command', async () => {
  const api = fakeApi({ recordWalletOpening: async () => ({ entryId: 'opening' }) });
  const wallet = fixtures.accounts.wallets.find(w => w.name === 'Bank')!;
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', walletId: wallet.id }} onClose={vi.fn()} />, api);
  const input = await screen.findByRole('textbox', { name: 'Missing opening amount' });
  await userEvent.type(input, '300');
  expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent('$8,744.60');
  await userEvent.click(screen.getByRole('button', { name: 'Save opening balance' }));
  await waitFor(() => expect(api.recordWalletOpening).toHaveBeenCalledWith(expect.objectContaining({ walletId: wallet.id, amount: 30000n, on: space().today })));
  expect(api.recordIncome).not.toHaveBeenCalled(); expect(api.assignMoney).not.toHaveBeenCalled();
});

it('assigns a category opening without modifying wallet cash or monthly funding', async () => {
  const api = fakeApi({ assignMoney: async () => ({ entryId: 'opening' }) });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', target: 'category', itemId: itemId('General savings') }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Opening amount' }), '300');
  await userEvent.click(screen.getByRole('button', { name: 'Save opening balance' }));
  await waitFor(() => expect(api.assignMoney).toHaveBeenCalledWith(expect.objectContaining({ opening: true, moves: [{ from: null, to: itemId('General savings'), currency: 'USD', amount: 30000n }] })));
  expect(api.recordWalletOpening).not.toHaveBeenCalled(); expect(api.recordIncome).not.toHaveBeenCalled();
});

it('refuses an opening assignment larger than unassigned cash and guides the user to Accounts', async () => {
  const api = fakeApi();
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', target: 'category', itemId: itemId('General savings') }} onClose={vi.fn()} />, api);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Opening amount' }), '9999');
  expect(screen.getByText(/There is not enough unassigned money/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save opening balance' }));
  expect(api.assignMoney).not.toHaveBeenCalled();
});

it('does not send invalid dates or fractional lira and accepts Arabic whole lira', async () => {
  const api = fakeApi({ recordWalletOpening: async () => ({ entryId: 'opening' }) });
  const wallet = fixtures.accounts.wallets.find(w => w.kind === 'cash' && w.currency === 'LBP')!;
  renderWithWorkspace(<RecordDialog intent={{ kind: 'opening', walletId: wallet.id }} onClose={vi.fn()} />, api, 'ar');
  const input = await screen.findByRole('textbox', { name: 'المبلغ الافتتاحي غير المسجل' });
  await userEvent.type(input, '١٥٠٠٫٥');
  await userEvent.click(screen.getByRole('button', { name: 'حفظ الرصيد الافتتاحي' }));
  expect(api.recordWalletOpening).not.toHaveBeenCalled();
  await userEvent.clear(input); await userEvent.type(input, '١٥٠٠');
  fireEvent.change(screen.getByLabelText('تاريخ الرصيد'), { target: { value: '2099-01-01' } });
  await userEvent.click(screen.getByRole('button', { name: 'حفظ الرصيد الافتتاحي' }));
  expect(api.recordWalletOpening).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('تاريخ الرصيد'), { target: { value: space().today } });
  await userEvent.click(screen.getByRole('button', { name: 'حفظ الرصيد الافتتاحي' }));
  await waitFor(() => expect(api.recordWalletOpening).toHaveBeenCalledWith(expect.objectContaining({ amount: 1500n, walletId: wallet.id })));
});
