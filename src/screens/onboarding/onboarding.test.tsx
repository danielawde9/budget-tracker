import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../../test/harness.tsx';
import { AssignStep, MoneyStep } from './onboarding.tsx';

const catalog = { accounts: { ...fixtures.accounts, wallets: [] }, plan: fixtures.plan, ready: { USD: 0n, LBP: 0n } };
const continueButton = () => screen.getByRole('button', { name: /^(Next|Save wallet and continue)$/ });

it('saves a filled wallet before continuing setup', async () => {
  const user = userEvent.setup();
  const api = fakeApi({ createWallet: async () => ({ walletId: 'wallet' }) });
  const onNext = vi.fn();
  renderWithWorkspace(<MoneyStep catalog={catalog} onNext={onNext} />, api);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Cash');
  await user.clear(screen.getByRole('textbox', { name: 'What it holds today' }));
  await user.type(screen.getByRole('textbox', { name: 'What it holds today' }), '350');
  await user.click(continueButton());
  await waitFor(() => expect(api.createWallet).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cash', opening: 35000n })));
  expect(onNext).toHaveBeenCalledOnce();
});

it('keeps the wallet draft in place when saving fails', async () => {
  const user = userEvent.setup();
  const api = fakeApi({ createWallet: async () => { throw new Error('offline'); } });
  const onNext = vi.fn();
  renderWithWorkspace(<MoneyStep catalog={catalog} onNext={onNext} />, api);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Cash');
  await user.click(continueButton());
  await waitFor(() => expect(api.createWallet).toHaveBeenCalledOnce());
  expect(onNext).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Cash');
  expect(screen.getByRole('alert')).toBeInTheDocument();
});

it('does not advance with an invalid wallet draft', async () => {
  const onNext = vi.fn();
  const api = fakeApi();
  renderWithWorkspace(<MoneyStep catalog={catalog} onNext={onNext} />, api);
  await userEvent.setup().click(continueButton());
  expect(onNext).not.toHaveBeenCalled();
  expect(api.createWallet).not.toHaveBeenCalled();
});

const assignmentCatalog = { ...catalog, accounts: fixtures.accounts };

it('preserves assignment drafts across groups and submits both currencies even when the current one is empty', async () => {
  const user = userEvent.setup();
  const api = fakeApi({ assignMoney: async () => ({ entryId: 'assignment' }) });
  const onFinish = vi.fn();
  renderWithWorkspace(<AssignStep catalog={assignmentCatalog} onFinish={onFinish} />, api);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign and finish' })).toBeEnabled());
  await user.type(screen.getByRole('textbox', { name: 'Rent' }), '50');
  const nav = screen.getByRole('navigation', { name: 'Assignment groups' });
  await user.click(within(nav).getByRole('button', { name: fixtures.plan.groups[1]!.nameEn! }));
  expect(screen.queryByRole('textbox', { name: 'Rent' })).not.toBeInTheDocument();
  await user.click(within(nav).getByRole('button', { name: 'Essentials' }));
  expect(screen.getByRole('textbox', { name: 'Rent' })).toHaveValue('50');
  await user.click(screen.getByRole('radio', { name: 'LBP' }));
  await user.click(screen.getByRole('button', { name: 'Assign and finish' }));
  expect(api.assignMoney).toHaveBeenCalledWith(expect.objectContaining({ opening: true, moves: [expect.objectContaining({ currency: 'USD', amount: 5000n })] }));
  expect(onFinish).toHaveBeenCalledOnce();
});

it('blocks assignment when a hidden currency draft exceeds its own balance', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<AssignStep catalog={assignmentCatalog} onFinish={vi.fn()} />, fakeApi());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign and finish' })).toBeEnabled());
  await user.type(screen.getByRole('textbox', { name: 'Rent' }), '999999');
  await user.click(screen.getByRole('radio', { name: 'LBP' }));
  expect(screen.getByRole('button', { name: 'Assign and finish' })).toBeDisabled();
});

it('retains an invalid hidden assignment draft and blocks saving', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<AssignStep catalog={assignmentCatalog} onFinish={vi.fn()} />, fakeApi());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign and finish' })).toBeEnabled());
  await user.type(screen.getByRole('textbox', { name: 'Rent' }), 'abc');
  await user.click(screen.getByRole('radio', { name: 'LBP' }));
  expect(screen.getByRole('button', { name: 'Assign and finish' })).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: 'USD' }));
  expect(screen.getByRole('textbox', { name: 'Rent' })).toHaveValue('abc');
});

it('does not save or discard a wallet with an invalid typed balance', async () => {
  const user = userEvent.setup();
  const onNext = vi.fn();
  const api = fakeApi({ createWallet: async () => ({ walletId: 'wallet' }) });
  renderWithWorkspace(<MoneyStep catalog={catalog} onNext={onNext} />, api);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Cash');
  const amount = screen.getByRole('textbox', { name: 'What it holds today' });
  await user.clear(amount);
  await user.type(amount, 'abc');
  await user.click(continueButton());
  expect(api.createWallet).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
  expect(amount).toHaveValue('abc');
});
