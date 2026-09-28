import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { coreMonthStateFixture, InMemoryAllocationGateway } from '../../test/in-memory-allocation-gateway.js';
import { MonthTransitionsPanel } from './month-transitions.js';

function baseProps() {
  return {
    locale: 'en' as const,
    spaceId: 'space-1',
    currency: 'USD' as const,
    month: '2026-09-01',
    gateway: new InMemoryAllocationGateway(),
  };
}

describe('MonthTransitionsPanel', () => {
  it('shows the copy and close controls and the saved-month history once ready', async () => {
    render(<MonthTransitionsPanel {...baseProps()} />);
    expect(await screen.findByRole('heading', { name: 'Month transitions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close month' })).toBeInTheDocument();
    expect(screen.getByText('Saved versions')).toBeInTheDocument();
  });

  it('opens the copy dialog for the previous month', async () => {
    render(<MonthTransitionsPanel {...baseProps()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy previous month' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copy a saved month' });
    await waitFor(() => expect(dialog).toBeInTheDocument());
  });

  it('opens the close dialog', async () => {
    render(<MonthTransitionsPanel {...baseProps()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Close month' }));
    expect(await screen.findByRole('dialog', { name: 'Close this month' })).toBeInTheDocument();
  });

  it('shows a load error with a Retry action that recovers', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.error = new Error('connection failure');
    render(<MonthTransitionsPanel {...baseProps()} gateway={gateway} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    gateway.error = null;
    gateway.monthState = coreMonthStateFixture;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Copy previous month' })).toBeInTheDocument();
  });

  it('calls onSpaceUnavailable when membership is lost', async () => {
    const gateway = new InMemoryAllocationGateway();
    gateway.error = Object.assign(new Error('planning_not_authorized'), { code: '42501' });
    const onSpaceUnavailable = vi.fn();
    render(<MonthTransitionsPanel {...baseProps()} gateway={gateway} onSpaceUnavailable={onSpaceUnavailable} />);
    await waitFor(() => expect(onSpaceUnavailable).toHaveBeenCalledTimes(1));
  });
});
