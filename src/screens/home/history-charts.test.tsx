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
  expect(within(within(savings).getByRole('group', { name: 'Choose a recorded month' })).getAllByRole('button')).toHaveLength(1);
  expect(within(savings).getByText(/Record another month/)).toBeInTheDocument();
});

it('explains empty history and uses Arabic chart titles', async () => {
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ moneyHistory: async () => ({ today: history.today, months: [] }) }), 'ar');
  const flows = await screen.findByRole('region', { name: 'الدخل مقابل الإنفاق' });
  expect(await within(flows).findByText('سجّل دخلاً أو مصروفاً لبدء عرض السجل.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'المدخرات عبر الأشهر' })).toBeInTheDocument();
});

it('inspects flow months on the plot by hover, keyboard focus and touch', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ moneyHistory: async () => history }));
  const flows = await screen.findByRole('region', { name: 'Income vs spending' });
  const plot = await within(flows).findByRole('group', { name: 'Inspect income and spending by month' });
  const september = within(plot).getByRole('button', { name: 'Inspect September 2026' });
  const october = within(plot).getByRole('button', { name: 'Inspect October 2026' });
  expect(within(flows).getByText('+$120.00')).toBeInTheDocument();
  expect(within(flows).getByText('Income minus spending.')).toBeInTheDocument();

  await user.hover(september);
  expect(within(flows).getByText('$100.00')).toBeInTheDocument();
  expect(within(flows).getByText('-$20.00')).toBeInTheDocument();
  expect(within(flows).getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-pressed', 'true');
  expect(september).toHaveAttribute('aria-pressed', 'true');

  await user.click(september);
  await user.tab();
  expect(october).toHaveFocus();
  expect(within(flows).getByText('$200.00')).toBeInTheDocument();
  expect(october).toHaveAttribute('aria-pressed', 'true');
  await user.pointer({ keys: '[TouchA]', target: september });
  expect(within(flows).getByText('-$20.00')).toBeInTheDocument();
  expect(september).toHaveAttribute('title', 'September 2026 · Income: $100.00 · Spending: $120.00');
});

it('updates exact savings balances from chart inspection and keeps month controls synchronized', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ moneyHistory: async () => history }));
  const savings = await screen.findByRole('region', { name: 'Savings over time' });
  const september = await within(savings).findByRole('button', { name: 'Sep: $300.00' });
  await user.hover(september);
  expect(within(savings).getByText('$300.00')).toBeInTheDocument();
  expect(within(savings).getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(savings).getByText('September 2026 · As of Sep 30')).toBeInTheDocument();

  await user.click(september);
  await user.keyboard('{ArrowRight}');
  expect(within(savings).getByRole('button', { name: 'Oct: $450.00' })).toHaveFocus();
  expect(within(savings).getByText('$450.00')).toBeInTheDocument();
  expect(within(savings).getByRole('button', { name: 'October 2026' })).toHaveAttribute('aria-pressed', 'true');
});

it('uses compact year-aware month labels without crowding a long flow history', async () => {
  const months = Array.from({ length: 24 }, (_, index) => ({
    ...history.months[0]!,
    month: `${2025 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`,
    through: `${2025 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-28`,
  }));
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ moneyHistory: async () => ({ ...history, months }) }));
  const flows = await screen.findByRole('region', { name: 'Income vs spending' });
  const chart = await within(flows).findByRole('img', { name: 'Income vs spending' });
  expect(within(flows).getByRole('button', { name: 'January 2025' })).toHaveTextContent('Jan ’25');
  expect(within(flows).getByRole('button', { name: 'December 2026' })).toHaveTextContent('Dec ’26');
  expect(chart.querySelectorAll('text').length).toBeLessThanOrEqual(9);
  expect(within(flows).getByRole('group', { name: 'Inspect income and spending by month' }).children).toHaveLength(24);
});

it('translates flow inspection and net cash flow into Arabic', async () => {
  renderWithWorkspace(<HomeScreen onRecord={vi.fn()} />, fakeApi({ moneyHistory: async () => history }), 'ar');
  const flows = await screen.findByRole('region', { name: 'الدخل مقابل الإنفاق' });
  expect(await within(flows).findByText('صافي التدفق النقدي')).toBeInTheDocument();
  expect(within(flows).getByText('الدخل ناقص الإنفاق.')).toBeInTheDocument();
  const plot = within(flows).getByRole('group', { name: 'استعراض الدخل والإنفاق حسب الشهر' });
  expect(within(plot).getAllByRole('button')).toHaveLength(2);
  expect(within(flows).getByText('مرّر المؤشر أو ركّز أو اضغط على شهر لعرض المبالغ الدقيقة.')).toBeInTheDocument();
});
