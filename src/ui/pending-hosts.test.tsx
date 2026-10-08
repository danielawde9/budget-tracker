import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { RecordDialog } from '../record/record-dialog.tsx';
import { PlanEditorDialog } from '../screens/plan/plan-editor.tsx';
import { fakeApi, fixtures, itemId, renderWithWorkspace } from '../test/harness.tsx';

it.each(['en', 'ar'] as const)('Record host blocks every dismissal and action switch while saving in %s', async (locale) => {
  let finish!: () => void;
  const close = vi.fn();
  const api = fakeApi({ recordExpense: async () => { await new Promise<void>(resolve => { finish = resolve; }); return { entryId: 'e', covered: 0n }; } });
  renderWithWorkspace(<RecordDialog intent={{ kind: 'expense', itemId: itemId('Groceries') }} onClose={close} />, api, locale);
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: locale === 'en' ? /^Amount/ : /^المبلغ/ }), '20');
  await user.click(screen.getByRole('button', { name: locale === 'en' ? 'Record expense' : 'تسجيل المصروف' }));
  const dialog = screen.getByRole('dialog');
  expect(screen.getByRole('button', { name: locale === 'en' ? 'Close' : 'إغلاق' })).toBeDisabled();
  const back = screen.getByRole('button', { name: locale === 'en' ? 'All actions' : 'كل الإجراءات' });
  expect(back).toBeDisabled();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  fireEvent.mouseDown(dialog); await user.click(back);
  expect(close).not.toHaveBeenCalled(); expect(dialog).toBeInTheDocument();
  finish(); await vi.waitFor(() => expect(screen.getByRole('button', { name: locale === 'en' ? 'Close' : 'إغلاق' })).toBeEnabled());
});

it('Plan host blocks close, Escape and backdrop until its save settles', async () => {
  let finish!: () => void;
  const close = vi.fn();
  const api = fakeApi({ savePlan: async () => { await new Promise<void>(resolve => { finish = resolve; }); return { versionId: 'v', revision: 3, effectiveMonth: '2026-10-01' }; } });
  renderWithWorkspace(<PlanEditorDialog plan={fixtures.plan} month="2026-10-01" onClose={close} />, api);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save plan' }));
  const dialog = screen.getByRole('dialog');
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  fireEvent(dialog, new Event('cancel', { cancelable: true })); fireEvent.mouseDown(dialog);
  expect(close).not.toHaveBeenCalled();
  finish(); await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});
