import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../../test/harness.tsx';
import { PlanEditorForm } from './plan-editor.tsx';

function essentials() {
  return screen.getByRole('group', { name: 'Essentials' });
}

describe('Plan editor', () => {
  it('previews each group’s flexible remainder exactly like the database', () => {
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, fakeApi());
    expect(within(essentials()).getByText('Other essentials gets $16.00')).toBeInTheDocument();
    expect(screen.getByText(/^100% planned/)).toBeInTheDocument();
  });

  it('shows an over-planned group instead of a flexible amount', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, fakeApi());
    const rent = within(essentials()).getAllByRole('textbox', { name: /Each month/ })[0];
    if (!rent) throw new Error('no Rent amount');
    await user.clear(rent);
    await user.type(rent, '1100');
    expect(within(essentials()).getByText('Items are $84.00 over this group’s share.')).toBeInTheDocument();
  });

  it('refuses group percentages above 100%', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, fakeApi());
    const percent = within(essentials()).getByRole('textbox', { name: 'Share of income' });
    await user.clear(percent);
    await user.type(percent, '70');
    expect(screen.getByText('Group percentages can’t add up to more than 100%.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  });

  it('saves the whole plan with the revision it was read at', async () => {
    const api = fakeApi({ savePlan: async () => ({ versionId: 'v', revision: 3, effectiveMonth: '2026-10-01' }) });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={onSaved} />, api);
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(api.savePlan).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-10-01', expectedRevision: fixtures.plan.revision }));
    const input = (api.savePlan.mock.calls[0]?.[0] as { plan: { groups: { percentBps: number }[] } }).plan;
    expect(input.groups.map((group) => group.percentBps)).toEqual([6000, 500, 1500, 1000, 1000]);
    expect(onSaved).toHaveBeenCalled();
  });
});
