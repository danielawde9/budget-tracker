import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BudgetError } from '../api/budget-api.ts';
import { SaveRecoveryStore } from '../api/save-recovery.ts';
import { fakeApi, renderWithWorkspace, space } from '../test/harness.tsx';
import { HomeScreen } from '../screens/home/home.tsx';
import { SaveRecoveryNotice, SaveRecoveryProvider } from './save-recovery.tsx';

it.each(['en', 'ar'] as const)('Home keeps an unresolved save after its form closes and finishes it in %s', async (locale) => {
  const store = new SaveRecoveryStore(); let calls = 0;
  const send = vi.fn(async () => { if (calls++ === 0) throw new BudgetError('NETWORK'); return { entryId: 'e' }; });
  await store.perform(space().id, 'original-request', 'record_expense', '{"p_amount":"2000"}', send).catch(() => {});
  const api = fakeApi();
  renderWithWorkspace(<SaveRecoveryProvider store={store}><SaveRecoveryNotice /><HomeScreen onRecord={vi.fn()} /></SaveRecoveryProvider>, api, locale);
  expect(screen.getByRole('alert', { name: locale === 'en' ? 'A save may not have finished' : 'قد لا تكون عملية الحفظ قد اكتملت' })).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: locale === 'en' ? 'Check and finish' : 'تحقق وأكمل' }));
  expect(send).toHaveBeenCalledTimes(2);
  expect(store.get(space().id)).toBeUndefined();
  await vi.waitFor(() => expect(api.overview.mock.calls.length).toBeGreaterThan(2));
});

it('clears a rejected recovery and displays its definite reason', async () => {
  const store = new SaveRecoveryStore(); let calls = 0;
  await store.perform(space().id, 'r', 'record_expense', '{}', async () => { throw new BudgetError(calls++ === 0 ? 'UNKNOWN' : 'BUDGET_BILL_SKIPPED'); }).catch(() => {});
  renderWithWorkspace(<SaveRecoveryProvider store={store}><SaveRecoveryNotice /></SaveRecoveryProvider>, fakeApi());
  await userEvent.setup().click(screen.getByRole('button', { name: 'Check and finish' }));
  expect(store.get(space().id)).toBeUndefined();
  expect(await screen.findByText('That bill was skipped for this date.')).toBeVisible();
});
