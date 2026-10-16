import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, renderWithWorkspace } from '../../test/harness.tsx';
import { HomeScreen } from './home.tsx';

const history = { today: '2026-10-10', months: [
  { month: '2026-09-01', through: '2026-09-30', income: { USD: 10000n, LBP: 1000000n }, spent: { USD: 12000n, LBP: 300000n }, savings: { USD: 30000n, LBP: 700000n } },
  { month: '2026-10-01', through: '2026-10-10', income: { USD: 20000n, LBP: 2000000n }, spent: { USD: 8000n, LBP: 600000n }, savings: { USD: 45000n, LBP: 1400000n } },
] };

it('shows recorded flows and cumulative savings, with visible month controls and separate currencies', async () => {
  const user = userEvent.setup();
  const api = fakeApi({ moneyHistory: async () => history });
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, api);
  const flows = await screen.findByRole('region', { name: 'Income vs spending' });
  const savings = screen.getByRole('region', { name: 'Savings over time' });
  await within(flows).findByRole('img', { name: /Income vs spending/ });
  expect(within(flows).getByText('$200.00')).toBeInTheDocument();
  expect(within(flows).getByText('$80.00')).toBeInTheDocument();
  expect(within(savings).getByText('$450.00')).toBeInTheDocument();
  expect(within(flows).getByText(/so far/)).toBeInTheDocument();
  await user.click(within(flows).getByRole('button', { name: 'September 2026' }));
  expect(within(flows).getByText('$100.00')).toBeInTheDocument();
  expect(within(flows).getByText('$120.00')).toBeInTheDocument();
  await user.click(within(savings).getByRole('button', { name: 'September 2026' }));
  expect(within(savings).getByText('$300.00')).toBeInTheDocument();
  await user.click(within(screen.getByRole('group', { name: 'Currency' })).getByRole('button', { name: 'LBP' }));
  expect(within(flows).getByText('LBP 1,000,000')).toBeInTheDocument();
  expect(within(savings).getByText('LBP 700,000')).toBeInTheDocument();
  expect(within(flows).queryByText('$100.00')).not.toBeInTheDocument();
  expect(api.moneyHistory).toHaveBeenCalledTimes(1);
});

it('keeps a refund-only month negative and shows one savings point without invented history', async () => {
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ moneyHistory: async () => ({ ...history, months: [{ ...history.months[1], spent: { USD: -500n, LBP: 0n } }] }) }));
  const flows = await screen.findByRole('region', { name: 'Income vs spending' });
  expect(await within(flows).findByText('-$5.00')).toBeInTheDocument();
  const savings = screen.getByRole('region', { name: 'Savings over time' });
  expect(within(savings).getAllByRole('button')).toHaveLength(1);
  expect(within(savings).getByText(/Record another month/)).toBeInTheDocument();
});

it('explains empty history and uses Arabic chart titles', async () => {
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ moneyHistory: async () => ({ today: history.today, months: [] }) }), 'ar');
  const flows = await screen.findByRole('region', { name: 'الدخل مقابل الإنفاق' });
  expect(await within(flows).findByText('سجّل دخلاً أو مصروفاً لبدء عرض السجل.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'المدخرات عبر الأشهر' })).toBeInTheDocument();
});
