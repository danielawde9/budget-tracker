import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../../test/harness.tsx';
import { PlanCharts } from './plan-charts.tsx';

it('explains category spending with an expandable item breakdown and remaining amount', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<PlanCharts plan={fixtures.plan} />, fakeApi());
  const comparison = screen.getByRole('region', { name: 'Planned vs spent' });
  const disclosure = within(comparison).getByText('Essentials', { exact: true }).closest('summary')!;
  expect(disclosure).not.toBeNull();
  await user.click(disclosure);
  const detail = disclosure.closest('details')!;
  expect(within(detail).getByText('Item breakdown')).toBeVisible();
  expect(within(detail).getByText('Groceries', { exact: true })).toBeVisible();
});

it('lets a budget allocation selection update the chart readout and reset to the total', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<PlanCharts plan={fixtures.plan} />, fakeApi());
  const mix = screen.getByRole('region', { name: 'Your budget at a glance' });
  const category = within(mix).getByRole('button', { name: /Essentials/ });
  await user.click(category);
  expect(category).toHaveAttribute('aria-pressed', 'true');
  expect(within(mix).getByRole('button', { name: 'Show total budget' })).toBeVisible();
  await user.click(within(mix).getByRole('button', { name: 'Show total budget' }));
  expect(category).toHaveAttribute('aria-pressed', 'false');
});
