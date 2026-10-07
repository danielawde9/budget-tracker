import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, renderWithWorkspace } from '../../test/harness.tsx';
import { SettingsScreen } from './settings.tsx';
import { render } from '@testing-library/react';
import { I18nProvider } from '../../lib/i18n.tsx';
import { WorkspaceProvider } from '../../app/workspace.tsx';
import { space, fixtures } from '../../test/harness.tsx';
import { Invitations } from './invitations.tsx';
import { BudgetError } from '../../api/budget-api.ts';

it('shows invitations in Settings and produces an email-bound link with a selectable fallback', async () => {
  const api = fakeApi({ createSpaceInvitation: async () => ({ invitationId: 'invite-1', expiresAt: '2026-10-13T12:00:00Z' }) });
  renderWithWorkspace(<SettingsScreen onToggleLocale={vi.fn()} onSignOut={vi.fn()} />, api);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Recipient email'), 'guest@example.com');
  await user.click(screen.getByRole('button', { name: 'Create invite link' }));
  const link = await screen.findByLabelText('Invite link');
  expect((link as HTMLInputElement).value).toMatch(/#\/invite\/[a-f0-9]{64}$/);
  expect(api.createSpaceInvitation).toHaveBeenCalledWith(expect.objectContaining({ email: 'guest@example.com', token: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  expect(screen.getByText(/Copy this link and send it/)).toBeInTheDocument();
});

it('reports an invitation failure and keeps the same token for a safe retry', async () => {
  const api = fakeApi({ createSpaceInvitation: async () => { throw new BudgetError('NETWORK'); } });
  renderWithWorkspace(<SettingsScreen onToggleLocale={vi.fn()} onSignOut={vi.fn()} />, api);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Recipient email'), 'guest@example.com');
  await user.click(screen.getByRole('button', { name: 'Create invite link' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Create invite link' }));
  expect(api.createSpaceInvitation.mock.calls[0]?.[0]).toEqual(api.createSpaceInvitation.mock.calls[1]?.[0]);
});

it('lets the owner revoke a pending invitation', async () => {
  const api = fakeApi({ spaceInvitations: async () => [{ invitationId: 'pending-1', email: 'guest@example.com', expiresAt: '2026-10-13T12:00:00Z' }], revokeSpaceInvitation: async () => ({ ok: true }) });
  renderWithWorkspace(<Invitations />, api);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Revoke' }));
  expect(api.revokeSpaceInvitation).toHaveBeenCalledWith(space().id, 'pending-1');
});
it('explains why a member cannot invite and makes no owner-only request', () => {
  const api = fakeApi();
  render(<I18nProvider locale="en"><WorkspaceProvider api={api} space={{ ...space(), role: 'member' }} spaces={fixtures.spaces} selectSpace={vi.fn()}><Invitations /></WorkspaceProvider></I18nProvider>);
  expect(screen.getByText('Only the space owner can invite members.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create invite link' })).not.toBeInTheDocument();
  expect(api.spaceInvitations).not.toHaveBeenCalled();
});
it('starts a new request when the recipient changes after a lost reply', async () => {
  const api = fakeApi({ createSpaceInvitation: async () => { throw new BudgetError('NETWORK'); } });
  renderWithWorkspace(<Invitations />, api);
  const user = userEvent.setup();
  const field = screen.getByLabelText('Recipient email');
  await user.type(field, 'first@example.com');
  await user.click(screen.getByRole('button', { name: 'Create invite link' }));
  await screen.findByRole('alert');
  await user.clear(field);
  await user.type(field, 'second@example.com');
  await user.click(screen.getByRole('button', { name: 'Create invite link' }));
  const first = api.createSpaceInvitation.mock.calls[0]?.[0];
  const second = api.createSpaceInvitation.mock.calls[1]?.[0];
  expect(second?.requestId).not.toBe(first?.requestId);
  expect(second?.token).not.toBe(first?.token);
});
