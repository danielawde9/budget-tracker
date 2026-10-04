import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { WalletForm, InvestForm } from './forms-accounts.tsx';
import { RecordDialog } from './record-dialog.tsx';
const catalog = { plan: fixtures.plan, accounts: fixtures.accounts, ready: { USD: 132000n, LBP: 0n } };
describe('focused owner record forms', () => {
  it('preserves debt signs in both the saved wallet and its confirmation', async () => {
    const api = fakeApi({ createWallet: async () => ({ walletId: 'new' }) });
    const onDone = vi.fn(); const user = userEvent.setup();
    renderWithWorkspace(<WalletForm onDone={onDone} onCancel={vi.fn()} />, api);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Card');
    await user.clear(screen.getByRole('textbox', { name: /What it holds today/ }));
    await user.type(screen.getByRole('textbox', { name: /What it holds today/ }), '100');
    await user.click(screen.getByRole('radio', { name: 'I owe this money' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.createWallet).toHaveBeenCalledWith(expect.objectContaining({ opening: -10000n }));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('-$100.00'));
  });
  it('groups uncommon actions under More while keeping contextual actions selected', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<RecordDialog intent={{ kind: 'transfer' }} onClose={vi.fn()} />, fakeApi());
    expect(await screen.findByRole('textbox', { name: /Amount/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All actions' }));
    expect(screen.getByRole('button', { name: /Change purpose/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Between wallets/, hidden: true })).not.toBeVisible();
    await user.click(screen.getByText('More actions'));
    expect(screen.getByRole('button', { name: /Between wallets/ })).toBeVisible();
  });
  it('previews a value update as a loss before recording it', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<InvestForm catalog={catalog} action="value" onDone={vi.fn()} onCancel={vi.fn()} />, fakeApi());
    await user.type(screen.getByRole('textbox', { name: /New total value/ }), '100');
    expect(screen.getByText(/This records .* loss/)).toBeInTheDocument();
  });
});

describe('funding keeps all groups in the same draft', () => {
  it('retains edits across groups and saves all lines together', async () => {
    const { FundForm } = await import('./forms-plan.tsx');
    const { itemId } = await import('../test/harness.tsx');
    const api = fakeApi({ fundingPreview: async () => ({ month: '2026-11-01', currency: 'USD', available: 132000n, unfunded: 10000n, lines: [{ itemId: itemId('Rent'), amountMinor: 20000n }, { itemId: itemId('Holiday'), amountMinor: 10000n }] }), assignMoney: async () => ({ entryId: 'e' }) });
    const user = userEvent.setup();
    renderWithWorkspace(<FundForm catalog={catalog} month="2026-11-01" onDone={vi.fn()} onCancel={vi.fn()} />, api);
    const rent = await screen.findByRole('textbox', { name: /Rent/ });
    await user.clear(rent); await user.type(rent, '150');
    await user.click(screen.getByRole('button', { name: 'Short-term goals' }));
    const holiday = screen.getByRole('textbox', { name: /Holiday/ });
    await user.clear(holiday); await user.type(holiday, '50');
    await user.click(screen.getByRole('button', { name: 'Essentials' }));
    expect(screen.getByRole('textbox', { name: /Rent/ })).toHaveValue('150');
    await user.click(screen.getByRole('button', { name: 'Set aside' }));
    expect(api.assignMoney).toHaveBeenCalledWith(expect.objectContaining({ moves: [expect.objectContaining({ to: itemId('Rent'), amount: 15000n }), expect.objectContaining({ to: itemId('Holiday'), amount: 5000n })] }));
  });
  it('opens the group containing an invalid hidden amount instead of saving zero', async () => {
    const { FundForm } = await import('./forms-plan.tsx');
    const { itemId } = await import('../test/harness.tsx');
    const api = fakeApi({ fundingPreview: async () => ({ month: '2026-11-01', currency: 'USD', available: 132000n, unfunded: 10000n, lines: [{ itemId: itemId('Rent'), amountMinor: 20000n }, { itemId: itemId('Holiday'), amountMinor: 10000n }] }) });
    const user = userEvent.setup();
    renderWithWorkspace(<FundForm catalog={catalog} month="2026-11-01" onDone={vi.fn()} onCancel={vi.fn()} />, api);
    const rent = await screen.findByRole('textbox', { name: /Rent/ });
    await user.clear(rent); await user.type(rent, 'oops');
    await user.click(screen.getByRole('button', { name: 'Short-term goals' }));
    await user.click(screen.getByRole('button', { name: 'Set aside' }));
    expect(api.assignMoney).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Rent/ })).toBeVisible();
  });
});

describe('all investment actions retain their accounting meaning', () => {
  it.each([
    ['contribute', '$160.00'], ['value', '$10.00'], ['withdraw', '$140.00'],
    ['fee', '$140.00'], ['income_cash', '$150.00'], ['income_reinvested', '$160.00'],
  ] as const)('previews and records %s', async (action, ending) => {
    const investment = fixtures.accounts.wallets.find(wallet => wallet.kind === 'investment')!;
    const local = { ...catalog, accounts: { wallets: fixtures.accounts.wallets.map(wallet => wallet.id === investment.id ? { ...wallet, balance: 15000n } : wallet) } };
    const api = fakeApi({ recordInvestment: async () => ({ entryId: 'e' }) });
    const user = userEvent.setup();
    renderWithWorkspace(<InvestForm catalog={local} action={action} onDone={vi.fn()} onCancel={vi.fn()} />, api);
    expect(screen.getByRole('combobox', { name: 'What happened?' }).querySelectorAll('option')).toHaveLength(6);
    await user.type(screen.getByRole('textbox', { name: action === 'value' ? /New total value/ : /Amount/ }), '10');
    expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent(`$150.00 → ${ending}`);
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(api.recordInvestment).toHaveBeenCalledWith(expect.objectContaining({ action, amount: 1000n }));
  });
});

describe('optional details retain draft values', () => {
  it('records a note even after its disclosure is closed', async () => {
    const { TransferForm } = await import('./forms-everyday.tsx');
    const api = fakeApi({ recordTransfer: async () => ({ entryId: 'e' }) });
    const user = userEvent.setup();
    renderWithWorkspace(<TransferForm catalog={catalog} onDone={vi.fn()} onCancel={vi.fn()} />, api);
    await user.type(screen.getByRole('textbox', { name: /Amount/ }), '10');
    const summary = document.querySelector('summary')!;
    await user.click(summary);
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Cash for the week');
    await user.click(summary);
    await user.click(screen.getByRole('button', { name: 'Record transfer' }));
    expect(api.recordTransfer).toHaveBeenCalledWith(expect.objectContaining({ memo: 'Cash for the week', amount: 1000n }));
  });
});
