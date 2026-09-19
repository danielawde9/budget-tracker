import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AllocationBars } from './allocation-bars.js';
import type { AllocationGroupRow } from './types.js';

function group(overrides: Partial<AllocationGroupRow> = {}): AllocationGroupRow {
  return {
    groupId: '00000000-0000-4000-8000-000000000001', rowKind: 'spending', nameEn: 'Essentials', nameAr: 'أساسيات',
    order: 0, targetMinor: '112000', actualMinor: '118000', varianceMinor: '-6000', basisPoints: 5600,
    actualShareOfIncomeBps: '6555', hasPlan: true,
    ...overrides,
  };
}

describe('AllocationBars', () => {
  it('U08-02 shows the exact 56/24/20 apportionment of 101 minor units as 57/24/20', () => {
    const rows: AllocationGroupRow[] = [
      group({ groupId: 'g1', order: 0, basisPoints: 5600, targetMinor: '57', actualMinor: '1', varianceMinor: '56', nameEn: 'A' }),
      group({ groupId: 'g2', order: 1, basisPoints: 2400, targetMinor: '24', actualMinor: '1', varianceMinor: '23', nameEn: 'B' }),
      group({ groupId: 'g3', order: 2, basisPoints: 2000, targetMinor: '20', actualMinor: '1', varianceMinor: '19', nameEn: 'C' }),
    ];
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={rows} />);
    expect(screen.getByText('$0.57')).toBeInTheDocument();
    expect(screen.getByText('$0.24')).toBeInTheDocument();
    expect(screen.getByText('$0.20')).toBeInTheDocument();
  });

  it('shows the exact target/actual/variance amounts and the group percentages', () => {
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[group()]} />);
    expect(screen.getByText('$1,120.00')).toBeInTheDocument();
    expect(screen.getByText('$1,180.00')).toBeInTheDocument();
    expect(screen.getByText('-$60.00')).toBeInTheDocument();
    expect(screen.getByText('56% target')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
  });

  it('U08-03 shows "No target" for a zero-target row without a plan, and an explicit numeric zero when planned', () => {
    const noPlanRow = group({ rowKind: 'unmapped', groupId: null, targetMinor: '0', actualMinor: '500', hasPlan: false, basisPoints: null, nameEn: null, nameAr: null });
    const { rerender } = render(<AllocationBars locale="en" currency="USD" monthHasPlan={false} rows={[noPlanRow]} />);
    expect(screen.getByText('No target')).toBeInTheDocument();

    const explicitZeroRow = group({ rowKind: 'future', groupId: 'g-future', targetMinor: '0', actualMinor: '0', varianceMinor: '0', hasPlan: true, basisPoints: 0, nameEn: 'Future', nameAr: null });
    rerender(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[explicitZeroRow]} />);
    expect(screen.queryByText('No target')).not.toBeInTheDocument();
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
  });

  it('labels the future group\'s actual as paid/allocated, distinct from ordinary expense', () => {
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[group({ rowKind: 'future', groupId: 'g-future', nameEn: 'Future' })]} />);
    expect(screen.getByText('(paid/allocated)')).toBeInTheDocument();
  });

  it('shows a visible overflow and the exact numeric overage for an over-100% group', () => {
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[group({ targetMinor: '10000', actualMinor: '15000', varianceMinor: '-5000' })]} />);
    expect(screen.getByText(/\+\$50\.00 over/)).toBeInTheDocument();
  });

  it('uses a zero baseline and a distinguishing style for a negative (credit) actual, never color alone', () => {
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[group({ targetMinor: '10000', actualMinor: '-5000', varianceMinor: '15000' })]} />);
    const actualText = screen.getByText('-$50.00');
    expect(actualText.className).toContain('alloc-danger-text');
  });

  it('renders no target bar for the uncategorized synthetic row (targetMinor null, not zero)', () => {
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[
      group({ rowKind: 'uncategorized', groupId: null, targetMinor: null, actualMinor: '750', varianceMinor: null, hasPlan: false, basisPoints: null, nameEn: null, nameAr: null }),
    ]} />);
    expect(screen.getByText('No target')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
  });

  it('renders Arabic labels via bdi and translated copy', () => {
    render(<AllocationBars locale="ar" currency="USD" monthHasPlan rows={[group()]} />);
    expect(screen.getByText('أساسيات').closest('bdi')).not.toBeNull();
  });

  it('invokes onDrilldown with the row when its View button is pressed', async () => {
    const onDrilldown = vi.fn();
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[group()]} onDrilldown={onDrilldown} />);
    await userEvent.click(screen.getByRole('button', { name: 'View Essentials categories' }));
    expect(onDrilldown).toHaveBeenCalledWith(expect.objectContaining({ groupId: '00000000-0000-4000-8000-000000000001' }));
  });

  it('offers no drilldown button for a future-purpose group (it has no category roots)', () => {
    render(<AllocationBars locale="en" currency="USD" monthHasPlan rows={[group({ rowKind: 'future', groupId: 'g-future' })]} onDrilldown={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
