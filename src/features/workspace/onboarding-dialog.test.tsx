import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingDialog } from './onboarding-dialog.js';
import type { OpeningBalanceInput } from './types.js';

describe('OnboardingDialog', () => {
  it('creates a mobile first space and wallet through one guided action', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    try {
      const user = userEvent.setup();
      const createSpace = vi.fn(async () => ({ id: 'mobile-space' }));
      const createWallet = vi.fn(async () => ({ id: 'mobile-wallet' }));
      const onComplete = vi.fn();
      render(<OnboardingDialog locale="en" createSpace={createSpace} createWallet={createWallet} onComplete={onComplete} />);
      const dialog = screen.getByRole('dialog', { name: 'Create your first space' });
      await user.type(within(dialog).getByLabelText('Space name'), 'My money');
      await user.type(within(dialog).getByLabelText('Wallet name'), 'Main wallet');
      await user.click(within(dialog).getByRole('button', { name: 'Create space and wallet' }));

      expect(createSpace).toHaveBeenCalledWith({ name: 'My money', kind: 'personal' });
      expect(createWallet).toHaveBeenCalledWith({ spaceId: 'mobile-space', name: 'Main wallet', currency: 'USD' });
      expect(onComplete).toHaveBeenCalledWith('mobile-space');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('recovers from mobile wallet rejection without creating the space again', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    try {
      const user = userEvent.setup();
      const createSpace = vi.fn(async () => ({ id: 'mobile-space' }));
      const createWallet = vi.fn().mockRejectedValueOnce(new Error('Wallet was not created')).mockResolvedValue({ id: 'mobile-wallet' });
      const onComplete = vi.fn();
      render(<OnboardingDialog locale="en" createSpace={createSpace} createWallet={createWallet} onComplete={onComplete} />);
      await user.type(screen.getByLabelText('Space name'), 'My money');
      await user.type(screen.getByLabelText('Wallet name'), 'Main wallet');
      await user.click(screen.getByRole('button', { name: 'Create space and wallet' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Wallet was not created');
      expect(screen.getByRole('heading', { name: 'Add your first wallet' })).toBeInTheDocument();
      expect(screen.getByLabelText('Wallet name')).toHaveValue('Main wallet');
      await user.click(screen.getByRole('button', { name: 'Create USD wallet' }));
      expect(createSpace).toHaveBeenCalledOnce();
      expect(createWallet).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenCalledWith('mobile-space');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('creates a personal space then its first USD wallet without invitations', async () => {
    const user = userEvent.setup();
    const createSpace = vi.fn(async () => ({ id: 'space-new' }));
    const createWallet = vi.fn(async () => ({ id: 'wallet-new' }));
    const complete = vi.fn();
    render(<OnboardingDialog locale="en" createSpace={createSpace} createWallet={createWallet} onComplete={complete} />);

    const dialog = screen.getByRole('dialog', { name: 'Create your first space' });
    expect(dialog).toHaveClass('onboarding-dialog', 'dialog-setup');
    expect(within(dialog).getByRole('list', { name: 'Setup progress' })).toBeInTheDocument();
    expect(within(dialog).getByText('Space')).toHaveAttribute('aria-current', 'step');
    expect(within(dialog).getByText('A personal space is private. Only you can see its wallets, loans and data.')).toBeInTheDocument();
    expect(within(dialog).getByText('For example: My money or Our home.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Space name'), 'My money');
    await user.click(within(dialog).getByRole('button', { name: 'Create personal space' }));
    expect(createSpace).toHaveBeenCalledWith({ name: 'My money', kind: 'personal' });

    expect(screen.getByRole('heading', { name: 'Add your first wallet' })).toBeInTheDocument();
    expect(screen.getByText('First wallet')).toHaveAttribute('aria-current', 'step');
    await user.type(screen.getByLabelText('Wallet name'), 'Daily USD');
    await user.click(screen.getByRole('button', { name: 'Create USD wallet' }));
    expect(createWallet).toHaveBeenCalledWith({ spaceId: 'space-new', name: 'Daily USD', currency: 'USD' });
    expect(complete).toHaveBeenCalledWith('space-new');
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
  });

  it('labels the space step for adding an additional space instead of the first one', () => {
    render(<OnboardingDialog locale="en" mode="additional" createSpace={vi.fn()} createWallet={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Add another space' })).toBeInTheDocument();
  });

  it('supports household and LBP choices and points to member management after setup', async () => {
    const user = userEvent.setup();
    render(<OnboardingDialog locale="en" createSpace={async () => ({ id: 'home' })} createWallet={async () => ({ id: 'wallet' })} onComplete={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Create your first space' });
    await user.click(within(dialog).getByRole('radio', { name: 'Household space' }));
    await user.type(within(dialog).getByLabelText('Space name'), 'Our home');
    await user.click(within(dialog).getByRole('button', { name: 'Create household space' }));
    expect(screen.getByText('After setup, invite members from Manage > Household.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'LBP' }));
    await user.type(screen.getByLabelText('Wallet name'), 'Home cash');
    expect(screen.getByRole('button', { name: 'Create LBP wallet' })).toBeInTheDocument();
  });

  it('preserves safe values after rejection and does not automatically submit again', async () => {
    const user = userEvent.setup();
    const createSpace = vi.fn(async () => { throw new Error('We checked your visible spaces. Nothing matched, so review the name before trying again.'); });
    render(<OnboardingDialog locale="en" createSpace={createSpace} createWallet={vi.fn()} onComplete={vi.fn()} />);
    const name = screen.getByLabelText('Space name');
    await user.type(name, 'My money');
    await user.click(screen.getByRole('button', { name: 'Create personal space' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We checked your visible spaces');
    expect(name).toHaveValue('My money');
    expect(createSpace).toHaveBeenCalledOnce();
  });

  it('preserves the wallet choice after a rejected wallet command', async () => {
    const user = userEvent.setup();
    const createWallet = vi.fn(async () => {
      throw new Error('The wallet was not created. Review the details before trying again.');
    });
    render(<OnboardingDialog locale="en" createSpace={async () => ({ id: 'home' })} createWallet={createWallet} onComplete={vi.fn()} />);

    await user.type(screen.getByLabelText('Space name'), 'Our home');
    await user.click(screen.getByRole('button', { name: 'Create personal space' }));
    await user.click(screen.getByRole('radio', { name: 'LBP' }));
    const walletName = screen.getByLabelText('Wallet name');
    await user.type(walletName, 'Home cash');
    await user.click(screen.getByRole('button', { name: 'Create LBP wallet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The wallet was not created');
    expect(walletName).toHaveValue('Home cash');
    expect(screen.getByRole('radio', { name: 'LBP' })).toBeChecked();
    expect(createWallet).toHaveBeenCalledOnce();
  });

  it('renders Arabic controls and keeps keyboard focus inside the required setup dialog', async () => {
    const user = userEvent.setup();
    render(<OnboardingDialog locale="ar" createSpace={vi.fn()} createWallet={vi.fn()} onComplete={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'إنشاء مساحتك الأولى' });
    expect(within(dialog).getByLabelText('اسم المساحة')).toBeInTheDocument();
    const first = within(dialog).getByRole('radio', { name: 'مساحة شخصية' });
    expect(within(dialog).getByRole('button', { name: 'إنشاء مساحة شخصية' })).toBeInTheDocument();
    first.focus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();
  });

  it('cancels an additional space from the close control and from Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OnboardingDialog locale="en" mode="additional" createSpace={vi.fn()} createWallet={vi.fn()} onComplete={vi.fn()} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Add another space' });

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('records the setup progress after creating the first space', async () => {
    const user = userEvent.setup();
    const onProgress = vi.fn();
    render(<OnboardingDialog locale="en" createSpace={async () => ({ id: 'space-1' })} createWallet={vi.fn()} onComplete={vi.fn()} onProgress={onProgress} />);
    await user.type(screen.getByLabelText('Space name'), 'My money');
    await user.click(screen.getByRole('button', { name: 'Create personal space' }));

    expect(onProgress).toHaveBeenCalledWith({ spaceId: 'space-1', balanceRequestId: expect.any(String) });
  });

  it('resumes an unfinished first run at the wallet step', () => {
    render(<OnboardingDialog locale="en" setup={{ spaceId: 'space-1', balanceRequestId: 'req-1' }} createSpace={vi.fn()} createWallet={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Add your first wallet' })).toBeInTheDocument();
  });

  it('adds a starting-balance step that reuses one request id across retries', async () => {
    const user = userEvent.setup();
    const recordOpeningBalance = vi.fn<(input: OpeningBalanceInput) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValue(undefined);
    const onComplete = vi.fn();
    render(<OnboardingDialog locale="en" createSpace={async () => ({ id: 'space-1' })} createWallet={async () => ({ id: 'wallet-1' })} onComplete={onComplete} recordOpeningBalance={recordOpeningBalance} />);

    await user.type(screen.getByLabelText('Space name'), 'My money');
    await user.click(screen.getByRole('button', { name: 'Create personal space' }));
    await user.type(screen.getByLabelText('Wallet name'), 'Cash');
    await user.click(screen.getByRole('button', { name: 'Create USD wallet' }));

    expect(screen.getByRole('heading', { name: 'Opening balance' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount'), '120.50');
    await user.click(screen.getByRole('button', { name: 'Record opening balance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network request failed');

    await user.click(screen.getByRole('button', { name: 'Record opening balance' }));
    expect(recordOpeningBalance).toHaveBeenCalledTimes(2);
    const first = recordOpeningBalance.mock.calls[0]![0];
    const second = recordOpeningBalance.mock.calls[1]![0];
    expect(second.requestId).toBe(first.requestId);
    expect(second).toMatchObject({ spaceId: 'space-1', walletId: 'wallet-1', amountMinor: '12050' });
    expect(onComplete).toHaveBeenCalledWith('space-1');
  });

  it('resumes at the starting-balance step with the persisted request id', async () => {
    const user = userEvent.setup();
    const recordOpeningBalance = vi.fn(async () => undefined);
    const onComplete = vi.fn();
    render(<OnboardingDialog locale="en" setup={{ spaceId: 'space-1', balanceRequestId: 'req-9', wallet: { id: 'wallet-1', currency: 'LBP' } }} createSpace={vi.fn()} createWallet={vi.fn()} onComplete={onComplete} recordOpeningBalance={recordOpeningBalance} />);

    expect(screen.getByRole('heading', { name: 'Opening balance' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount'), '5000');
    await user.click(screen.getByRole('button', { name: 'Record opening balance' }));

    expect(recordOpeningBalance).toHaveBeenCalledWith({ spaceId: 'space-1', walletId: 'wallet-1', amountMinor: '5000', requestId: 'req-9' });
    expect(onComplete).toHaveBeenCalledWith('space-1');
  });

  it('lets a person finish setup without a starting balance', async () => {
    const user = userEvent.setup();
    const recordOpeningBalance = vi.fn(async () => undefined);
    const onComplete = vi.fn();
    render(<OnboardingDialog locale="en" createSpace={async () => ({ id: 'space-1' })} createWallet={async () => ({ id: 'wallet-1' })} onComplete={onComplete} recordOpeningBalance={recordOpeningBalance} />);

    await user.type(screen.getByLabelText('Space name'), 'My money');
    await user.click(screen.getByRole('button', { name: 'Create personal space' }));
    await user.type(screen.getByLabelText('Wallet name'), 'Cash');
    await user.click(screen.getByRole('button', { name: 'Create USD wallet' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(recordOpeningBalance).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith('space-1');
  });
});
