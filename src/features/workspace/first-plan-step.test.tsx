import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstPlanStep } from './first-plan-step.js';
import { InMemoryPlanClient } from '../../test/in-memory-plan-client.js';
import type { CategoriesGateway } from '../categories/types.js';

export function planServices() {
  const plan = new InMemoryPlanClient();
  const categories = {
    listCategories: vi.fn(async () => ({ categories: [], nextCursor: null })),
    createCategory: vi.fn(async () => ({ id: 'category-1' })),
    getCommandResult: vi.fn(async () => null),
  } as unknown as CategoriesGateway;
  const loadClock = vi.fn(async () => ({ today: '2026-10-02', currentMonth: '2026-10-01', timezone: 'Asia/Beirut' }));
  return { plan, categories, loadClock };
}

function mount(locale: 'en' | 'ar' = 'en') {
  const services = planServices();
  const onComplete = vi.fn();
  render(<FirstPlanStep locale={locale} spaceId="space-1" initialCurrency="USD" services={services} onComplete={onComplete} />);
  return { ...services, onComplete };
}

describe('first monthly plan onboarding', () => {
  beforeEach(() => sessionStorage.clear());
  it('links amount and percent in both directions and preserves the last entry basis when income changes', async () => {
    const user = userEvent.setup();
    mount();
    const income = await screen.findByLabelText('Monthly income');
    await user.type(income, '2500');
    const amount = screen.getByLabelText('Groceries amount');
    const percent = screen.getByLabelText('Groceries % of income');
    await user.type(amount, '350');
    expect(percent).toHaveValue('14');
    await user.clear(percent);
    await user.type(percent, '20');
    expect(amount).toHaveValue('500');
    await user.clear(income);
    await user.type(income, '3000');
    expect(amount).toHaveValue('600');
    await user.clear(amount);
    await user.type(amount, '350');
    await user.clear(income);
    await user.type(income, '2500');
    expect(amount).toHaveValue('350');
    expect(percent).toHaveValue('14');
    expect(screen.getByTestId('first-plan-remaining')).toHaveTextContent('$2,150.00');
  });
  it('keeps currency drafts separate and does not save placeholders', async () => {
    const user = userEvent.setup();
    const { plan, onComplete } = mount();
    await user.type(await screen.findByLabelText('Monthly income'), '2500');
    await user.type(screen.getByLabelText('Groceries amount'), '350');
    await user.click(screen.getByRole('radio', { name: 'LBP' }));
    expect(screen.getByLabelText('Monthly income')).toHaveValue('');
    await user.click(screen.getByRole('radio', { name: 'USD' }));
    expect(screen.getByLabelText('Groceries amount')).toHaveValue('350');
    await user.click(screen.getByRole('button', { name: 'Create my plan' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(plan.calls.map(c => c.name)).toEqual(['setIncomePlan', 'setCategoryTarget']);
    expect(plan.calls[1]?.input).toMatchObject({ amountMinor: '35000', currency: 'USD', month: '2026-10-01' });
  });
  it('prevents an overallocated plan and keeps user input after a save failure', async () => {
    const user = userEvent.setup();
    const { plan, onComplete } = mount();
    await user.type(await screen.findByLabelText('Monthly income'), '100');
    await user.type(screen.getByLabelText('Groceries amount'), '150');
    await user.click(screen.getByRole('button', { name: 'Create my plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('exceed');
    expect(plan.calls).toHaveLength(0);
    await user.clear(screen.getByLabelText('Groceries amount'));
    await user.type(screen.getByLabelText('Groceries amount'), '50');
    plan.error = new Error('Network unavailable');
    await user.click(screen.getByRole('button', { name: 'Create my plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByLabelText('Groceries amount')).toHaveValue('50');
    expect(onComplete).not.toHaveBeenCalled();
  });
  it('allows skipping without writes and supports Arabic labels', async () => {
    const user = userEvent.setup();
    const { plan, categories, onComplete } = mount('ar');
    await screen.findByLabelText('الدخل الشهري');
    await user.click(screen.getByRole('button', { name: 'سأخطط لاحقًا' }));
    expect(plan.calls).toHaveLength(0);
    expect(categories.createCategory).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
  });
  it('restores entered figures when returning to an unfinished plan', async () => {
    const user = userEvent.setup();
    const services = planServices();
    const props = { locale: 'en' as const, spaceId: 'space-1', initialCurrency: 'USD' as const, services, onComplete: vi.fn() };
    const view = render(<FirstPlanStep {...props} />);
    await user.type(await screen.findByLabelText('Monthly income'), '2500');
    await user.type(screen.getByLabelText('Groceries % of income'), '14');
    view.unmount();
    render(<FirstPlanStep {...props} />);
    expect(await screen.findByLabelText('Monthly income')).toHaveValue('2500');
    expect(screen.getByLabelText('Groceries amount')).toHaveValue('350');
  });

});
