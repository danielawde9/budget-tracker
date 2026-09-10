import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  householdMemberId,
  householdOwnerId,
  householdSpaceId,
  InMemoryHouseholdGateway,
} from '../../test/in-memory-household-gateway.js';
import { HouseholdPage } from './household-page.js';

async function renderPage(gateway = new InMemoryHouseholdGateway(), locale: 'en' | 'ar' = 'en', userId = householdOwnerId) {
  const user = userEvent.setup();
  const unavailable = vi.fn();
  render(<HouseholdPage gateway={gateway} locale={locale} spaceId={householdSpaceId} spaceName="Home budget" userId={userId} onSpaceUnavailable={unavailable} />);
  await waitFor(() => expect(screen.queryByRole('status', { name: /Loading household|تحميل المساحة/i })).not.toBeInTheDocument());
  return { gateway, unavailable, user };
}

async function confirm(user: ReturnType<typeof userEvent.setup>, actionName: string | RegExp) {
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: actionName }));
}

describe('HouseholdPage', () => {
  it('renders the bounded owner roster and invitation lifecycle using isolated database values', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Household access' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invitations' })).toBeInTheDocument();
    expect(screen.getAllByText(householdMemberId).every((node) => node.closest('bdi') !== null)).toBe(true);
    expect(screen.getAllByText('Home budget').every((node) => node.closest('bdi') !== null)).toBe(true);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText(/email|recipient/i)).not.toBeInTheDocument();
  });

  it('creates an invitation record without rendering a token or claiming delivery', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const dialog = screen.getByRole('dialog', { name: 'Create invitation record' });
    await user.type(within(dialog).getByLabelText('Member email'), 'person@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Create invitation record' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Invitation record created. Delivery is not configured.');
    expect(document.body).not.toHaveTextContent('secret-token');
    expect(document.body).not.toHaveTextContent('Invitation sent');
    expect(gateway.calls.some((call) => call.name === 'createInvitation')).toBe(true);
  });

  it('promotes and removes another member only after explicit confirmation', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: `Promote ${householdMemberId} to owner` }));
    await confirm(user, 'Promote to owner');
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'setMemberRole')).toBe(true));
    await user.click(screen.getByRole('button', { name: `Remove ${householdMemberId}` }));
    await confirm(user, 'Remove access');
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'removeMember')).toBe(true));
  });

  it('cancels pending invitations through a confirmation dialog', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: /Cancel invitation/ }));
    await confirm(user, 'Cancel invitation');
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'cancelInvitation')).toBe(true));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('shows an active member only their own access and leave action', async () => {
    const gateway = new InMemoryHouseholdGateway();
    gateway.memberships = gateway.memberships.map((entry) => ({ ...entry, isSelf: entry.userId === householdMemberId }));
    const { user } = await renderPage(gateway, 'en', householdMemberId);
    expect(screen.getByRole('heading', { name: 'Your household access' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invitations' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Leave household' }));
    await confirm(user, 'Leave household');
    await waitFor(() => expect(gateway.calls.some((call) => call.name === 'leaveHousehold')).toBe(true));
  });

  it('recovers from a safe initial failure without exposing the raw cause', async () => {
    cleanup();
    const gateway = new InMemoryHouseholdGateway();
    gateway.error = new Error('household_invitation_token_digest leaked');
    const user = userEvent.setup();
    render(<HouseholdPage gateway={gateway} locale="en" spaceId={householdSpaceId} spaceName="Home budget" userId={householdOwnerId} onSpaceUnavailable={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('household request was not accepted');
    expect(screen.getByRole('alert')).not.toHaveTextContent('token_digest');
    gateway.error = null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument();
  });

  it('localizes Arabic management and restores opener focus after Escape', async () => {
    const { user } = await renderPage(new InMemoryHouseholdGateway(), 'ar');
    expect(screen.getByRole('heading', { name: 'إدارة المنزل' })).toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'دعوة عضو' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'إنشاء سجل دعوة' });
    await user.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
