import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../../test/harness.tsx';
import { ActivityScreen } from './activity.tsx';
import { ActivityCharts } from './activity-charts.tsx';

it('previews exact day counts and filters journal rows on a keyboard selection with a clear path back', async () => {
  const user = userEvent.setup();
  const { container } = renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, fakeApi());
  const day = await screen.findByRole('button', { name: 'Show records on Oct 2, 2026 · 3' });
  expect(container.querySelectorAll('.cr-register-row')).toHaveLength(6);

  await user.hover(day);
  expect(screen.getByText('Oct 2, 2026 · 3 loaded records')).toBeInTheDocument();
  expect(container.querySelectorAll('.cr-register-row')).toHaveLength(6);
  await user.unhover(day);
  act(() => day.focus());
  const otherDay = screen.getByRole('button', { name: 'Show records on Oct 3, 2026 · 1' });
  await user.hover(otherDay);
  expect(screen.getByText('Oct 3, 2026 · 1 loaded record')).toBeInTheDocument();
  await user.unhover(otherDay);
  expect(screen.getByText('Oct 2, 2026 · 3 loaded records')).toBeInTheDocument();
  await user.keyboard('{Enter}');

  expect(day).toHaveAttribute('aria-pressed', 'true');
  expect(container.querySelectorAll('.cr-register-row')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /Supermarket/ })).not.toBeInTheDocument();
  expect(screen.getByText('3 · Matching records')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show records on Oct 3, 2026 · 1' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show all loaded days' }));
  expect(container.querySelectorAll('.cr-register-row')).toHaveLength(6);
  expect(day).toHaveAttribute('aria-pressed', 'false');
});

it('uses the existing type filter and preserves the selected day, search and account filters', async () => {
  const user = userEvent.setup();
  const walletId = fixtures.accounts.wallets[0]!.id;
  const api = fakeApi({ activity: async (_space: string, options: { filter?: Record<string, string> }) => ({
    entries: fixtures.activity.entries.filter(entry => !options.filter?.['kind'] || entry.kind === options.filter['kind']), next: null,
  }) });
  const { container } = renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} walletId={walletId} month="2026-10-01" />, api);
  await user.click(await screen.findByRole('button', { name: 'Show records on Oct 2, 2026 · 3' }));
  await user.click(screen.getByRole('button', { name: 'Filter by Expense · 1' }));
  await waitFor(() => expect(api.activity).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    filter: { month: '2026-10-01', walletId, kind: 'expense' },
  })));
  await screen.findByRole('button', { name: 'Show records on Oct 2, 2026 · 1' });
  expect(screen.getByRole('combobox', { name: 'All transaction types' })).toHaveValue('expense');
  expect(container.querySelectorAll('.cr-register-row')).toHaveLength(1);
  await user.type(screen.getByRole('searchbox'), 'insurance');
  expect(container.querySelectorAll('.cr-register-row')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Show all types' }));
  await waitFor(() => expect(api.activity).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    filter: { month: '2026-10-01', walletId },
  })));
  expect(screen.getByRole('searchbox')).toHaveValue('insurance');
  expect(screen.getByRole('button', { name: 'Show all loaded days' })).toBeInTheDocument();
});

it('keeps day counts current when another loaded page adds matching records', async () => {
  const user = userEvent.setup();
  const entry = fixtures.activity.entries[0]!;
  const api = fakeApi({ activity: async (_space: string, options: { before?: unknown }) => options.before
    ? { entries: [{ ...entry, entryId: 'older-match', memo: 'Another purchase' }], next: null }
    : { entries: [entry], next: fixtures.activity.next } });
  const { container } = renderWithWorkspace(<ActivityScreen onRecord={vi.fn()} />, api);
  await user.click(await screen.findByRole('button', { name: 'Show records on Oct 3, 2026 · 1' }));
  await user.click(screen.getByRole('button', { name: 'Show more' }));
  expect(await screen.findByText('Oct 3, 2026 · 2 loaded records')).toBeInTheDocument();
  expect(container.querySelectorAll('.cr-register-row')).toHaveLength(2);
  expect(screen.getByText('2 · Matching records')).toBeInTheDocument();
});

it('keeps the accessible daily table and translates drill-down controls into Arabic', async () => {
  const user = userEvent.setup();
  renderWithWorkspace(<ActivityCharts entries={fixtures.activity.entries} />, fakeApi(), 'ar');
  expect(screen.getByRole('img', { name: 'القيود حسب اليوم' })).toBeInTheDocument();
  expect(await screen.findAllByRole('button', { name: /^عرض قيود يوم/ })).toHaveLength(3);
  await user.click(screen.getByText('عدد القيود اليومي', { exact: true }));
  const table = screen.getByRole('table', { name: 'القيود حسب اليوم' });
  expect(within(table).getByRole('columnheader', { name: 'التاريخ' })).toBeInTheDocument();
  expect(within(table).getByRole('columnheader', { name: 'القيود' })).toBeInTheDocument();
});
