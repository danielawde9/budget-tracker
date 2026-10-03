import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, itemId, renderWithWorkspace } from '../test/harness.tsx';
import { FundForm } from './forms-plan.tsx';

const catalog = { plan: { ...fixtures.plan, ready: 50000n }, accounts: fixtures.accounts };

function preview() {
  return {
    month: '2026-11-01', currency: 'USD' as const, available: 50000n, unfunded: 361000n,
    lines: [{ itemId: itemId('Rent'), amountMinor: 50000n }],
  };
}

describe('Fund my plan', () => {
  it('lets each proposed line be edited and refuses more than is ready', async () => {
    const api = fakeApi({ fundingPreview: async () => preview(), assignMoney: async () => ({ entryId: 'e1' }) });
    const user = userEvent.setup();
    renderWithWorkspace(<FundForm catalog={catalog} month="2026-11-01" onDone={vi.fn()} onCancel={vi.fn()} />, api);
    const rent = await screen.findByRole('textbox', { name: /Rent/ });
    expect(screen.getByText('Still to fund after this: $3,610.00.')).toBeInTheDocument();
    await user.clear(rent);
    await user.type(rent, '600');
    expect(screen.getByText('Only $500.00 is ready to assign.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set aside' })).toBeDisabled();
    await user.clear(rent);
    await user.type(rent, '400');
    await user.click(screen.getByRole('button', { name: 'Set aside' }));
    expect(api.assignMoney).toHaveBeenCalledWith(expect.objectContaining({ moves: [{ from: null, to: itemId('Rent'), currency: 'USD', amount: 40000n }] }));
  });
});
