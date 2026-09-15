import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AvailableCashGroupRow } from './types.js';
import { CommitmentBreakdown, groupCommitmentRatio } from './commitment-breakdown.js';

function group(overrides: Partial<AvailableCashGroupRow> = {}): AvailableCashGroupRow {
  return {
    id: '00000000-0000-4000-8000-000000000901', nameEn: 'Essentials', nameAr: 'الأساسيات',
    budgetRemainingMinor: '20000', unpaidBillsMinor: '50000', goalOverlapMinor: '30000', commitmentMinor: '20000',
    ...overrides,
  };
}

describe('groupCommitmentRatio', () => {
  it('is unavailable for a Future-purpose group (null unpaidBillsMinor)', () => {
    expect(groupCommitmentRatio(group({ unpaidBillsMinor: null, goalOverlapMinor: null }))).toEqual({
      hasScale: false, percent: 0, over: false, overageMinor: null,
    });
  });
  it('has no scale when the remaining budget line is zero', () => {
    expect(groupCommitmentRatio(group({ budgetRemainingMinor: '0' })).hasScale).toBe(false);
  });
  it('computes over-100% overage from the original BigInt values, not the clamped coordinate', () => {
    const ratio = groupCommitmentRatio(group({ budgetRemainingMinor: '20000', unpaidBillsMinor: '30000' }));
    expect(ratio.hasScale).toBe(true);
    expect(ratio.percent).toBe(100); // clamped visual coordinate
    expect(ratio.over).toBe(true);
    expect(ratio.overageMinor).toBe('10000'); // exact overage, not derived from percent
  });
  it('is not over when unpaid bills sit within the remaining budget', () => {
    const ratio = groupCommitmentRatio(group({ budgetRemainingMinor: '20000', unpaidBillsMinor: '5000' }));
    expect(ratio.over).toBe(false);
    expect(ratio.overageMinor).toBeNull();
    expect(ratio.percent).toBe(25);
  });
  // Finding 5 (final whole-release review): a Future-purpose group's
  // budgetRemainingMinor is unclamped by the DB and reachable-negative
  // (goal targets + debt commitment can exceed the group's own target).
  // hasScale stays false (no meaningful bar for a Future row), but the
  // textual overcommitted signal must still fire from the sign alone.
  it('is over (with no scale) for an overcommitted Future-purpose group -- negative budgetRemainingMinor', () => {
    const ratio = groupCommitmentRatio(group({ budgetRemainingMinor: '-15000', unpaidBillsMinor: null, goalOverlapMinor: null }));
    expect(ratio).toEqual({ hasScale: false, percent: 0, over: true, overageMinor: '15000' });
  });
  it('is not over for a healthy (non-negative) Future-purpose group', () => {
    const ratio = groupCommitmentRatio(group({ budgetRemainingMinor: '0', unpaidBillsMinor: null, goalOverlapMinor: null }));
    expect(ratio).toEqual({ hasScale: false, percent: 0, over: false, overageMinor: null });
  });
});

describe('CommitmentBreakdown', () => {
  it('shows a message and no table when there are no groups', () => {
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[]} />);
    expect(screen.getByText('No reservation components to show yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // U19-02: the group's own commitmentMinor (already the server-computed,
  // deduplicated Q_g) is rendered as its own distinct "Net reserved" value --
  // never re-added to unpaidBillsMinor or goalOverlapMinor client-side. A
  // goal of 30000 funds a 50000 bill, leaving exactly 20000 still reserved
  // (never 50000+30000=80000, and never displayed as a re-summed figure).
  it('U19-02: renders the already-deduplicated net commitment distinctly from unpaid bills and goal overlap', () => {
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group({
      budgetRemainingMinor: '0', unpaidBillsMinor: '50000', goalOverlapMinor: '30000', commitmentMinor: '20000',
    })]} />);
    const row = screen.getByText('Essentials').closest('tr')!;
    expect(within(row).getByText('$500.00')).toBeInTheDocument(); // unpaid bills
    expect(within(row).getByText('$300.00')).toBeInTheDocument(); // covered by goal
    expect(within(row).getByText('$200.00')).toBeInTheDocument(); // net reserved -- not $800.00
    expect(within(row).queryByText('$800.00')).not.toBeInTheDocument();
  });

  it('wraps every rendered amount and the group name in its own <bdi>', () => {
    const { container } = render(<CommitmentBreakdown locale="en" currency="USD" groups={[group()]} />);
    const bdiTexts = [...container.querySelectorAll('bdi')].map((node) => node.textContent);
    expect(bdiTexts).toContain('Essentials');
    expect(bdiTexts).toContain('$200.00'); // budget remaining
    expect(bdiTexts).toContain('$500.00'); // unpaid bills
    expect(bdiTexts).toContain('$300.00'); // covered by goal
    expect(bdiTexts).toContain('$200.00'); // net reserved (repeat value from fixture, still its own bdi)
  });

  it('shows a visible overflow bar and the exact numeric overage past 100%', () => {
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group({
      budgetRemainingMinor: '20000', unpaidBillsMinor: '30000', goalOverlapMinor: '0', commitmentMinor: '30000',
    })]} />);
    const bar = document.querySelector('.cc-progress');
    expect(bar).toHaveAttribute('data-over', 'true');
    expect(screen.getByText('$100.00').closest('.cc-overage-text')).toHaveTextContent('over remaining budget');
  });

  it('shows an explicit "no remaining budget line" note instead of a misleading empty bar when the budget line is zero', () => {
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group({ budgetRemainingMinor: '0' })]} />);
    expect(screen.getByText('No remaining budget line to compare against.')).toBeInTheDocument();
    expect(document.querySelector('.cc-progress')).not.toBeInTheDocument();
  });

  it('marks a Future-purpose group as Not applicable for the two spending-only columns, with no bar', () => {
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group({
      nameEn: 'Future', unpaidBillsMinor: null, goalOverlapMinor: null, commitmentMinor: '21000',
    })]} />);
    const row = screen.getByText('Future').closest('tr')!;
    expect(within(row).getAllByText('Not applicable')).toHaveLength(2);
    expect(document.querySelector('.cc-progress')).not.toBeInTheDocument();
  });

  // Finding 5 (final whole-release review): before this fix, an
  // overcommitted Future group showed an unexplained negative number under
  // a "Budget remaining" header (the same header spending groups use, where
  // the figure is clamped and means something different) with no overage
  // flag at all -- hasScale:false made the whole bar-visual-row unreachable
  // for every Future row. Now the row gets its own "Headroom" label and the
  // overcommitted signal is visible, with still no bar (no meaningful scale
  // for a Future row).
  it('shows a distinct "Headroom" label and a visible overcommitted indicator for a Future group with negative budgetRemainingMinor', () => {
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group({
      nameEn: 'Future', budgetRemainingMinor: '-15000', unpaidBillsMinor: null, goalOverlapMinor: null, commitmentMinor: '21000',
    })]} />);
    const row = screen.getByText('Future').closest('tr')!;
    expect(within(row).getByText('Headroom')).toBeInTheDocument();
    expect(within(row).getByText('-$150.00')).toBeInTheDocument();
    // Before this fix, no .cc-progress AND no .cc-overage-text ever rendered
    // for a Future row (the whole bar-visual-row was gated on `applicable`,
    // which is always false for a Future group) -- the overage was silently
    // unreachable. Now the textual signal (no bar; hasScale stays false)
    // is visible.
    expect(document.querySelector('.cc-progress')).not.toBeInTheDocument();
    const overage = screen.getByText('Overcommitted by').closest('.cc-overage-text')!;
    expect(overage).toHaveTextContent('$150.00');
  });

  it('shows no overage indicator for a healthy (non-negative) Future-purpose group, same as before', () => {
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group({
      nameEn: 'Future', unpaidBillsMinor: null, goalOverlapMinor: null, commitmentMinor: '21000',
    })]} />);
    expect(screen.queryByText(/Overcommitted by/)).not.toBeInTheDocument();
    expect(document.querySelector('.cc-bar-visual-row')).not.toBeInTheDocument();
  });

  it('expands the Future-purpose group’s own explanation, distinct from the spending-group one', async () => {
    const user = userEvent.setup();
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group({
      nameEn: 'Future', unpaidBillsMinor: null, goalOverlapMinor: null, commitmentMinor: '21000',
    })]} />);
    await user.click(screen.getByRole('button', { name: 'Details Future' }));
    const detail = document.querySelector('.cc-detail-row')!;
    expect(detail).toHaveTextContent('already included in the debt/goal totals above');
    expect(detail.querySelectorAll('bdi')).toHaveLength(1);
    expect(detail).toHaveTextContent('$210.00');
  });

  it('expands a plain-language detail explanation on the labelled Details button and collapses it again', async () => {
    const user = userEvent.setup();
    render(<CommitmentBreakdown locale="en" currency="USD" groups={[group()]} />);
    const button = screen.getByRole('button', { name: 'Details Essentials' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.cc-detail-row')).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const detail = document.querySelector('.cc-detail-row')!;
    expect(detail).toHaveTextContent('still reserved against a remaining budget of $200.00');
    expect(detail.querySelectorAll('bdi')).toHaveLength(4); // every amount in the sentence its own <bdi>

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.cc-detail-row')).not.toBeInTheDocument();
  });

  it('renders Arabic labels and RTL-safe amounts', () => {
    render(<CommitmentBreakdown locale="ar" currency="USD" groups={[group()]} />);
    expect(screen.getByText('الأساسيات')).toBeInTheDocument();
    expect(screen.getByText('المجموعة')).toBeInTheDocument();
  });
});
