import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi } from '../test/harness.tsx';
import { I18nProvider } from '../lib/i18n.tsx';
import { BudgetError } from '../api/budget-api.ts';
import { InviteAcceptance } from './invite-acceptance.tsx';
import { parseRoute } from './router.ts';

it('keeps the invite token through sign-in and requires an explicit acceptance', async () => {
  const secret = 'a'.repeat(64);
  expect(parseRoute(`#/invite/${secret}`)).toEqual({ name: 'invite', token: secret });
  const api = fakeApi({ acceptSpaceInvitation: async () => ({ spaceId: 'shared-space' }) });
  const accepted = vi.fn();
  render(<I18nProvider locale="en"><InviteAcceptance api={api} token={secret} onAccepted={accepted} onSignOut={vi.fn()} /></I18nProvider>);
  expect(api.acceptSpaceInvitation).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Accept invitation' }));
  expect(api.acceptSpaceInvitation).toHaveBeenCalledWith(secret);
  expect(accepted).toHaveBeenCalledWith('shared-space');
});
it('shows a useful refusal and lets a recipient switch accounts', async () => {
  const api = fakeApi({ acceptSpaceInvitation: async () => { throw new BudgetError('BUDGET_INVITATION_INVALID'); } });
  const signOut = vi.fn(); const accepted = vi.fn();
  render(<I18nProvider locale="en"><InviteAcceptance api={api} token="invalid" onAccepted={accepted} onSignOut={signOut} /></I18nProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('intended for another email');
  expect(accepted).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Sign in with another account' }));
  expect(signOut).toHaveBeenCalled();
});
