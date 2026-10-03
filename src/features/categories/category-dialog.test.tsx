import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CategoryDialog } from './category-dialog.js';

describe('CategoryDialog', () => {
  it('requires one bounded name and submits the active language only', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => { throw { code: 'P0001', message: 'an active category already uses one of the supplied normalized names' }; });
    render(<CategoryDialog locale="en" initialKind="expense" pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onRefresh={vi.fn()} onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Create a category' });
    expect(within(dialog).getByLabelText('English name')).toHaveFocus();
    const description = within(dialog).getByText(/Add a name for your income or expense category/);
    expect(description.id).not.toBe('');
    expect(dialog).toHaveAttribute('aria-describedby', description.id);

    await user.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('at least one category name');
    await user.type(within(dialog).getByLabelText('English name'), 'Groceries');
    expect(within(dialog).queryByLabelText('Arabic name')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'expense', nameEn: 'Groceries', nameAr: null });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already uses one of these names');
    expect(within(dialog).getByDisplayValue('Groceries')).toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue('بقالة')).not.toBeInTheDocument();
  });

  it('submits Arabic only and retains an English draft when the locale changes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    const props = { initialKind: 'expense' as const, pending: false, ambiguous: false, onClose: vi.fn(), onClearAmbiguous: vi.fn(), onRetry: vi.fn(), onRefresh: vi.fn(), onSubmit };
    const { rerender } = render(<CategoryDialog {...props} locale="en" />);
    await user.type(screen.getByLabelText('English name'), 'Transport');
    rerender(<CategoryDialog {...props} locale="ar" />);
    expect(screen.queryByLabelText('الاسم بالإنجليزية')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('الاسم بالعربية'), 'المواصلات');
    await user.click(screen.getByRole('button', { name: 'إنشاء الفئة' }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'expense', nameEn: 'Transport', nameAr: 'المواصلات' });
  });

  it('announces ambiguity and clears recovery on edit', async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    const retry = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    const { rerender } = render(<CategoryDialog locale="en" initialKind="income" pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={clear} onRetry={retry} onRefresh={vi.fn()} onSubmit={vi.fn(async () => ({ status: 'ambiguous' as const, reconciled: false }))} />);
    const dialog = screen.getByRole('dialog', { name: 'Create a category' });
    await user.type(within(dialog).getByLabelText('English name'), 'Bonus');
    await user.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('result is still unknown');

    rerender(<CategoryDialog locale="en" initialKind="income" pending={false} ambiguous onClose={vi.fn()} onClearAmbiguous={clear} onRetry={retry} onRefresh={vi.fn()} onSubmit={vi.fn()} />);
    await user.type(within(dialog).getByLabelText('English name'), ' updated');
    expect(clear).toHaveBeenCalled();
  });

  it('offers an explicit unchanged retry and announces reconciled success', async () => {
    const user = userEvent.setup();
    const retry = vi.fn(async () => ({ status: 'success' as const, reconciled: true }));
    const { rerender } = render(<CategoryDialog locale="en" initialKind="income" pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={retry} onRefresh={vi.fn()} onSubmit={vi.fn(async () => ({ status: 'ambiguous' as const, reconciled: false }))} />);
    const dialog = screen.getByRole('dialog', { name: 'Create a category' });
    await user.type(within(dialog).getByLabelText('English name'), 'Bonus');
    await user.click(within(dialog).getByRole('button', { name: 'Create category' }));
    rerender(<CategoryDialog locale="en" initialKind="income" pending={false} ambiguous onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={retry} onRefresh={vi.fn()} onSubmit={vi.fn()} />);
    await user.click(within(dialog).getByRole('button', { name: 'Retry unchanged category' }));
    expect(retry).toHaveBeenCalledOnce();
    const status = await within(dialog).findByRole('status');
    expect(status).toHaveTextContent('Category created');
    const description = within(dialog).getByText('The active register was refreshed from the server.');
    expect(description.id).not.toBe('');
    expect(dialog).toHaveAttribute('aria-describedby', description.id);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus());
  });

  it('keeps accepted values and offers refresh without replaying creation', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => ({ status: 'refresh-required' as const, reconciled: false }));
    const refresh = vi.fn(async () => true);
    render(<CategoryDialog locale="en" initialKind="income" pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onRefresh={refresh} onSubmit={submit} />);
    const dialog = screen.getByRole('dialog', { name: 'Create a category' });
    await user.type(within(dialog).getByLabelText('English name'), 'Bonus');
    await user.click(within(dialog).getByRole('button', { name: 'Create category' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('saved, but the current register could not be refreshed');
    expect(within(dialog).getByDisplayValue('Bonus')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Refresh categories' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Category created');
  });

  it('provides equivalent Arabic controls with trapped focus and safe Escape close', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<CategoryDialog locale="ar" initialKind="income" pending={false} ambiguous={false} onClose={close} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onRefresh={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'إنشاء فئة' });
    expect(within(dialog).getByLabelText('الاسم بالعربية')).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });
});
