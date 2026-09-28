import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AllocationHistoryRow } from './types.js';
import { MonthHistory } from './month-history.js';

const historyRow: AllocationHistoryRow = {
  snapshotId: '12', createdAt: '2026-09-14T12:00:00Z', actorId: '11111111-1111-4111-8111-111111111111',
  plannedIncomeMinor: '200000', templateRevisionId: '9',
};

describe('MonthHistory', () => {
  it('lists a saved month version with its planned income', () => {
    render(<MonthHistory locale="en" currency="USD" month="2026-09-01" status="ready" rows={[historyRow]} />);
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
  });

  it('shows a loading state', () => {
    render(<MonthHistory locale="en" currency="USD" month="2026-09-01" status="loading" rows={[]} />);
    expect(screen.getByText('Loading saved versions…')).toBeInTheDocument();
  });

  it('shows an empty state when the month has no saved versions', () => {
    render(<MonthHistory locale="en" currency="USD" month="2026-09-01" status="ready" rows={[]} />);
    expect(screen.getByText('No saved versions for this month yet.')).toBeInTheDocument();
  });

  it('localizes its copy into Arabic', () => {
    render(<MonthHistory locale="ar" currency="USD" month="2026-09-01" status="ready" rows={[]} />);
    expect(screen.getByText('لا توجد نسخ محفوظة لهذا الشهر بعد.')).toBeInTheDocument();
  });
});
