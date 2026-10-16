import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { ActivityScreen } from './activity/activity.tsx';
import { PlanCharts } from './plan/plan-charts.tsx';
import { HomeScreen } from './home/home.tsx';
import { ActivityCharts } from './activity/activity-charts.tsx';

it('does not let surplus funding or carried cash conceal another item’s shortfall', () => {
  const base = fixtures.plan.groups[0]!;
  const item = base.items[0]!;
  const plan = { ...fixtures.plan, groups: [{ ...base, nameEn: 'Essentials', flex: null, items: [
    { ...item, itemId: 'surplus', planned: 10000n, funded: 20000n, stillToFund: 0n, broughtForward: 90000n },
    { ...item, itemId: 'short', planned: 10000n, funded: 0n, stillToFund: 10000n },
  ] }] };
  renderWithWorkspace(<PlanCharts plan={plan} />, fakeApi());
  expect(screen.getByRole('progressbar', { name: 'Essentials · Target funded' })).toHaveValue(50);
  expect(within(screen.getByRole('region', { name: 'Funding progress' })).getByText('Still to add: $100.00')).toBeInTheDocument();
});

it('compares spending without treating saving or investing as purchases', () => {
  renderWithWorkspace(<PlanCharts plan={fixtures.plan} />, fakeApi());
  const spending = screen.getByRole('region', { name: 'Planned vs spent' });
  for (const group of fixtures.plan.groups.filter(group => group.purpose === 'savings')) {
    expect(within(spending).queryByText(group.nameEn!)).not.toBeInTheDocument();
  }
  expect(screen.getByRole('region', { name: 'Your budget at a glance' })).toBeInTheDocument();
});

it('updates the activity charts with the same search as the register', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, fakeApi());
  await screen.findByRole('img', { name: 'Records by day' });
  await user.type(screen.getByRole('searchbox'), 'no-such-record');
  expect(screen.queryByRole('img', { name: 'Records by day' })).not.toBeInTheDocument();
  expect(screen.getByText('0 · Matching records')).toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox'));
  expect(screen.getByRole('img', { name: 'Records by day' })).toBeInTheDocument();
});

it('offers daily activity counts in an accessible table', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<ActivityCharts entries={fixtures.activity.entries} />, fakeApi());
  await user.click(screen.getByText('Daily activity counts', { exact: true }));
  const table = screen.getByRole('table', { name: 'Records by day' });
  expect(within(table).getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'Records' })).toBeInTheDocument();
  expect(within(table).getByRole('row', { name: /Oct 3 1/ })).toBeInTheDocument();
});

it('allows history to fail and retry independently of the spending overview', async () => {
  const user = userEvent.setup();
  let fail = true;
  const api = fakeApi({
    activity: async () => ({ ...fixtures.activity, next: null }),
    moneyHistory: async () => { if (fail) throw new Error('offline'); return { today: fixtures.overview.today, months: [] }; },
  });
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, api);
  const history = await screen.findByRole('region', { name: 'Income vs spending' });
  const retry = await within(history).findByRole('button', { name: 'Try again' });
  expect(screen.getByRole('img', { name: /Actual vs. planned expenses/ })).toBeInTheDocument();
  fail = false;
  await user.click(retry);
  expect(await within(history).findByText('Record income or spending to start your history.')).toBeInTheDocument();
});
