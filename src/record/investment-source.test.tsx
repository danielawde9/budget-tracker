import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { fakeApi, fixtures, renderWithWorkspace } from '../test/harness.tsx';
import { PlanScreen } from '../screens/plan/plan.tsx';
import { ItemStatementDialog } from '../screens/plan/item-statement.tsx';
import { RecordDialog } from './record-dialog.tsx';

const original = fixtures.plan.groups.find(group => group.nameEn === 'Investments')!;
const source = { ...original.flex!, itemId: '10000000-0000-0000-0000-000000000001', nameEn: 'Second investment pool', balances: { USD: 50000n, LBP: 0n } };
const second = { ...original, groupId: '10000000-0000-0000-0000-000000000002', nameEn: 'Second investments', items: [], flex: source };
const plan = { ...fixtures.plan, groups: [...fixtures.plan.groups, second] };

it('keeps the investment group selected by its visible shortcut', async () => {
  const onRecord = vi.fn();
  const user = userEvent.setup();
  renderWithWorkspace(<PlanScreen month={plan.month} onRecord={onRecord} />, fakeApi({ planMonth: async () => plan }));
  const group = await screen.findByRole('group', { name: 'Second investments' });
  if (!(group as HTMLDetailsElement).open) await user.click(group.querySelector('summary')!);
  await user.click(within(group).getByRole('button', { name: 'Investments' }));
  expect(onRecord).toHaveBeenCalledWith({ kind: 'invest', action: 'contribute', itemId: source.itemId });
});

it('keeps the investment item selected from its statement', async () => {
  const onRecord = vi.fn();
  const user = userEvent.setup();
  renderWithWorkspace(<ItemStatementDialog item={source} month={plan.month} purpose="saving" onRecord={onRecord} onClose={vi.fn()} />, fakeApi({ itemStatement: async () => ({ statement: [], entries: [] }) }));
  await user.click(await screen.findByRole('button', { name: 'Investments' }));
  expect(onRecord).toHaveBeenCalledWith({ kind: 'invest', action: 'contribute', itemId: source.itemId });
});

it('records an investment from the opened source instead of the first investment pool', async () => {
  const api = fakeApi({ planMonth: async () => plan, recordInvestment: async () => ({ entryId: 'e' }) });
  const user = userEvent.setup();
  renderWithWorkspace(<RecordDialog intent={{ kind: 'invest', action: 'contribute', itemId: source.itemId }} onClose={vi.fn()} />, api);
  expect(await screen.findByRole('combobox', { name: 'Money set aside in' })).toHaveValue(source.itemId);
  await user.type(screen.getByRole('textbox', { name: /Amount/ }), '10');
  await user.click(screen.getByRole('button', { name: 'Record' }));
  expect(api.recordInvestment).toHaveBeenCalledWith(expect.objectContaining({ action: 'contribute', itemId: source.itemId, amount: 1000n }));
});
