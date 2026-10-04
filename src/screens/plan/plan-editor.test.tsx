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

  it('edits one group at a time and preserves drafts when switching', async () => {
    const user = userEvent.setup();
    const api = fakeApi({ savePlan: async () => ({ versionId: 'v', revision: 3, effectiveMonth: '2026-10-01' }) });
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, api);
    const nav = screen.getByRole('navigation', { name: 'Plan groups' });
    const groups = fixtures.plan.groups;
    const second = groups[1]!;
    await user.clear(within(essentials()).getByRole('textbox', { name: 'Group name' }));
    await user.type(within(screen.getByRole('group', { name: 'New group' })).getByRole('textbox', { name: 'Group name' }), 'My essentials');
    await user.click(within(nav).getByRole('button', { name: second.nameEn! }));
    expect(screen.queryByRole('textbox', { name: 'Group name' })).toHaveValue(second.nameEn);
    await user.click(within(nav).getByRole('button', { name: 'My essentials' }));
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveValue('My essentials');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(api.savePlan).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ groups: expect.arrayContaining([expect.objectContaining({ nameEn: 'My essentials' })]) }) }));
  });

  it('keeps invalid new items blocking save even after changing groups', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, fakeApi());
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Plan groups' })).getByRole('button', { name: fixtures.plan.groups[1]!.nameEn! }));
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  });

  it('creates a goal with optional fields and preserves it across groups', async () => {
    const user = userEvent.setup();
    const api = fakeApi({ savePlan: async () => ({ versionId: 'v', revision: 3, effectiveMonth: '2026-10-01' }) });
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, api);
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    const fields = screen.getAllByRole('textbox', { name: 'Item name' });
    const field = fields.at(-1)!;
    await user.type(field, 'Holiday');
    const row = field.closest('li')!;
    await user.click(within(row).getByText('Item details and options'));
    await user.selectOptions(within(row).getByRole('combobox', { name: 'Kind' }), 'goal');
    await user.type(within(row).getByRole('textbox', { name: 'Target (optional)' }), '500');
    await user.click(within(screen.getByRole('navigation', { name: 'Plan groups' })).getByRole('button', { name: fixtures.plan.groups[1]!.nameEn! }));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(api.savePlan).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ groups: expect.arrayContaining([expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ nameEn: 'Holiday', kind: 'goal', monthly: 0n, target: 50000n })]) })]) }) }));
  });

  it('retains an invalid monthly amount when changing groups', async () => {
    const user = userEvent.setup();
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, fakeApi());
    const amount = within(essentials()).getAllByRole('textbox', { name: 'Each month' })[0]!;
    await user.clear(amount);
    await user.type(amount, 'abc');
    const nav = screen.getByRole('navigation', { name: 'Plan groups' });
    await user.click(within(nav).getByRole('button', { name: fixtures.plan.groups[1]!.nameEn! }));
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    await user.click(within(nav).getByRole('button', { name: 'Essentials' }));
    expect(within(essentials()).getAllByRole('textbox', { name: 'Each month' })[0]).toHaveValue('abc');
  });

  it('retains an invalid optional target and prevents saving another group', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderWithWorkspace(<PlanEditorForm plan={fixtures.plan} month="2026-10-01" onCancel={vi.fn()} onSaved={vi.fn()} />, api);
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    const field = screen.getAllByRole('textbox', { name: 'Item name' }).at(-1)!;
    await user.type(field, 'Holiday');
    const row = field.closest('li')!;
    await user.click(within(row).getByText('Item details and options'));
    await user.selectOptions(within(row).getByRole('combobox', { name: 'Kind' }), 'goal');
    await user.type(within(row).getByRole('textbox', { name: 'Target (optional)' }), 'abc');
    const nav = screen.getByRole('navigation', { name: 'Plan groups' });
    await user.click(within(nav).getByRole('button', { name: fixtures.plan.groups[1]!.nameEn! }));
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(api.savePlan).not.toHaveBeenCalled();
    await user.click(within(nav).getByRole('button', { name: 'Essentials' }));
    const target = within(row).getByRole('textbox', { name: 'Target (optional)' });
    expect(target).toHaveValue('abc');
    await user.clear(target);
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled();
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
