import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ControlRoomShell } from './control-room-shell.js';

const baseProps = {
  locale: 'en' as const,
  userEmail: 'daniel@example.com',
  activeDestination: 'home' as const,
  onDestinationChange: vi.fn(),
  onLocaleChange: vi.fn(),
  onSignOut: vi.fn(),
  onRecord: vi.fn(),
  spaceControls: <div>space controls</div>,
};

describe('ControlRoomShell', () => {
  it('renders five tab-bar slots with the record action in the center', () => {
    render(<ControlRoomShell {...baseProps}>content</ControlRoomShell>);
    for (const name of ['Home', 'Journal', 'Plan', 'Manage']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: 'Record' }).length).toBeGreaterThan(0);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('marks the active destination and reports changes', async () => {
    const user = userEvent.setup();
    const onDestinationChange = vi.fn();
    render(<ControlRoomShell {...baseProps} onDestinationChange={onDestinationChange}>x</ControlRoomShell>);
    expect(screen.getAllByRole('button', { name: 'Home' })[0]!).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getAllByRole('button', { name: 'Journal' })[0]!);
    expect(onDestinationChange).toHaveBeenCalledWith('journal');
  });

  it('record button calls onRecord, not navigation', async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    const onDestinationChange = vi.fn();
    render(<ControlRoomShell {...baseProps} onRecord={onRecord} onDestinationChange={onDestinationChange}>x</ControlRoomShell>);
    await user.click(screen.getAllByRole('button', { name: 'Record' })[0]!);
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onDestinationChange).not.toHaveBeenCalled();
  });

  it('renders Arabic labels when locale is ar', () => {
    render(<ControlRoomShell {...baseProps} locale="ar">x</ControlRoomShell>);
    expect(screen.getAllByRole('button', { name: 'الرئيسية' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'سجل' }).length).toBeGreaterThan(0);
  });
});
