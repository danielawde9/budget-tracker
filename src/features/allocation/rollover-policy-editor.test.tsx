import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RolloverPolicyEditor } from './rollover-policy-editor.js';
import type { CloseRootRow } from './types.js';

const rootId = '00000000-0000-4000-8000-000000000010';

function root(overrides: Partial<CloseRootRow> = {}): CloseRootRow {
  return {
    categoryId: rootId, nameEn: 'Groceries', nameAr: 'بقالة',
    groupId: '00000000-0000-4000-8000-000000000001',
    baseMinor: '10000', carryMinor: '0', effectiveMinor: '10000',
    actualMinor: '12500', outgoingCarryMinor: '-2500', enabled: false, policyRevisionId: null, carrySourceCloseId: null,
    ...overrides,
  };
}

describe('RolloverPolicyEditor', () => {
  it('shows the signed outgoing carry for an enabled root and no carry otherwise', () => {
    const { rerender } = render(
      <RolloverPolicyEditor locale="en" currency="USD" roots={[root({ enabled: true, outgoingCarryMinor: '-2500' })]} pending={false} onSetRollover={vi.fn()} />,
    );
    expect(screen.getByText('-$25.00')).toBeInTheDocument();
    rerender(<RolloverPolicyEditor locale="en" currency="USD" roots={[root({ enabled: false })]} pending={false} onSetRollover={vi.fn()} />);
    expect(screen.getByText('No carry')).toBeInTheDocument();
  });

  it('opts a root in with its current policy head as the expected revision', async () => {
    const onSetRollover = vi.fn().mockResolvedValue({ status: 'success', reconciled: false, result: { revisionId: '4' } });
    render(<RolloverPolicyEditor locale="en" currency="USD" roots={[root({ policyRevisionId: '3' })]} pending={false} onSetRollover={onSetRollover} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Carry Groceries into next month' }));
    await waitFor(() => expect(onSetRollover).toHaveBeenCalledWith({ rootId, enabled: true, expectedRevisionId: '3' }));
  });

  it('surfaces a localized stale-policy rejection without crashing', async () => {
    const onSetRollover = vi.fn().mockRejectedValue(Object.assign(new Error('planning_stale_revision'), { code: '40001' }));
    render(<RolloverPolicyEditor locale="en" currency="USD" roots={[root()]} pending={false} onSetRollover={onSetRollover} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Carry Groceries into next month' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed elsewhere/i);
  });

  it('shows an empty state when the month has no expense roots', () => {
    render(<RolloverPolicyEditor locale="en" currency="USD" roots={[]} pending={false} onSetRollover={vi.fn()} />);
    expect(screen.getByText("No expense categories in this month's plan.")).toBeInTheDocument();
  });
});
