import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../../test/harness.tsx';
import { HomeScreen } from './home.tsx';

describe('Home', () => {
  it('shows cash held = set aside + ready to assign, straight from the database', async () => {
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    const money = await screen.findByRole('region', { name: 'Your money' });
    expect(within(money).getByText('$8,712.60')).toBeInTheDocument();
    expect(within(money).getByText('$7,392.60')).toBeInTheDocument();
    expect(within(money).getAllByText('$1,320.00').length).toBeGreaterThanOrEqual(2);
    expect(within(money).getByText('$16,225.60')).toBeInTheDocument();
  });

  it('keeps LBP in its own pile and never adds it to USD', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi());
    const money = await screen.findByRole('region', { name: 'Your money' });
    expect(within(money).queryByText(/2,685,000/)).not.toBeInTheDocument();
    await user.click(within(money).getByRole('button', { name: 'LBP' }));
    expect(within(money).getAllByText('LBP 2,685,000').length).toBeGreaterThanOrEqual(2);
    expect(within(money).getByText(/≈ \$30\.00/)).toBeInTheDocument();
    expect(within(money).queryByText('$8,712.60')).not.toBeInTheDocument();
  });

  it('lists this month’s bills with their coverage and a pay action', async () => {
    const onRecord = vi.fn();
    const user = userEvent.setup();
    renderWithWorkspace(<HomeScreen onRecord={onRecord} />, fakeApi());
    const bills = await screen.findByRole('region', { name: 'Upcoming bills' });
    const internet = (await within(bills).findByText('Internet')).closest('li');
    if (!internet) throw new Error('no Internet row');
    expect(within(internet).getByText('Covered')).toBeInTheDocument();
    await user.click(within(internet).getByRole('button', { name: 'Pay' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expense', bill: expect.objectContaining({ name: 'Internet', amount: 4500n }) }));
  });
});


it('replaces the zero assignment hero with real spending and allocation charts', async () => {
  const api = fakeApi({
    overview: async () => ({ ...fixtures.overview, currencies: fixtures.overview.currencies.map(c => ({ ...c, ready: 0n })) }),
    activity: async () => ({ ...fixtures.activity, next: null }),
  });
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, api);
  const chart = await screen.findByRole('img', { name: /Spending this month/ });
  expect(chart).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Where your money is assigned' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Category progress' })).toBeInTheDocument();
  const money = screen.getByRole('region', { name: 'Your money' });
  expect(money.querySelector('.cr-hero')).toBeNull();
  expect(screen.getAllByRole('progressbar').length).toBe(fixtures.plan.groups.length);
});
