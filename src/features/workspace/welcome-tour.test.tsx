import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeTourDialog } from './welcome-tour.js';

function renderTour(locale: 'en' | 'ar' = 'en') {
  const onDismiss = vi.fn();
  const onTryIt = vi.fn();
  render(<WelcomeTourDialog locale={locale} onDismiss={onDismiss} onTryIt={onTryIt} />);
  return { onDismiss, onTryIt };
}

describe('WelcomeTourDialog', () => {
  it('starts on the Quick add step with a step counter and a Next action', async () => {
    renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 1 of 4.')).toBeInTheDocument();
    expect(within(dialog).getByText('Quick add')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Skip tour' })).toBeInTheDocument();
  });

  it('cycles through all four steps and finishes with Get started', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 2 of 4.')).toBeInTheDocument();
    expect(within(dialog).getByText('Reports & insights')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 3 of 4.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('Four quick things that make budgeting easier. 4 of 4.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Get started' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Get started' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('emits each step target from Try it', async () => {
    const user = userEvent.setup();
    const { onTryIt } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(dialog).getByRole('button', { name: 'Try it →' }));
    expect(onTryIt).toHaveBeenCalledWith('record');

    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Try it →' }));
    expect(onTryIt).toHaveBeenLastCalledWith('reports');

    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Try it →' }));
    expect(onTryIt).toHaveBeenLastCalledWith('goals');
  });

  it('keeps focus inside the dialog and dismisses with Escape', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dismisses with Skip tour', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome back!' });

    await user.click(within(dialog).getByRole('button', { name: 'Skip tour' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders the Arabic copy', async () => {
    renderTour('ar');
    expect(await screen.findByRole('dialog', { name: 'مرحبًا بعودتك!' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeInTheDocument();
    expect(screen.getByText('أربع ميزات سريعة تجعل الميزانية أسهل. 1 من 4.')).toBeInTheDocument();
  });
});
