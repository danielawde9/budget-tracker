import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Category } from './types.js';
import { SubcategoryDialog } from './subcategory-dialog.js';

const parent: Category = {
  id: 'category-essentials', spaceId: 'space-1', kind: 'expense', nameEn: 'Essentials', nameAr: 'الأساسيات',
  parentCategoryId: null, createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
};

describe('SubcategoryDialog', () => {
  it('keeps the parent immutable and retains bilingual values after rejection', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(async () => {
      throw { code: 'P0001', message: 'an active category already uses one of the supplied normalized names' };
    });
    render(<SubcategoryDialog locale="en" parent={parent} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onRefresh={vi.fn()} onSubmit={submit} />);
    const dialog = screen.getByRole('dialog', { name: 'Create a subcategory' });
    expect(within(dialog).getAllByText('Essentials').every((value) => value.closest('bdi') !== null)).toBe(true);
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('English name')).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Create subcategory' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('at least one subcategory name');
    await user.type(within(dialog).getByLabelText('English name'), 'Groceries');
    await user.type(within(dialog).getByLabelText('Arabic name'), 'بقالة');
    await user.click(within(dialog).getByRole('button', { name: 'Create subcategory' }));

    expect(submit).toHaveBeenCalledWith({ nameEn: 'Groceries', nameAr: 'بقالة' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already uses one of these names');
    expect(within(dialog).getByLabelText('English name')).toHaveValue('Groceries');
    expect(within(dialog).getByLabelText('Arabic name')).toHaveValue('بقالة');
  });

  it('offers only an unchanged retry and announces server-refetched success', async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    const retry = vi.fn(async () => ({ status: 'success' as const, reconciled: true }));
    const { rerender } = render(<SubcategoryDialog locale="en" parent={parent} pending={false} ambiguous={false} onClose={vi.fn()} onClearAmbiguous={clear} onRetry={retry} onRefresh={vi.fn()} onSubmit={vi.fn(async () => ({ status: 'ambiguous' as const, reconciled: false }))} />);
    const dialog = screen.getByRole('dialog', { name: 'Create a subcategory' });
    await user.type(within(dialog).getByLabelText('English name'), 'Groceries');
    await user.click(within(dialog).getByRole('button', { name: 'Create subcategory' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('result is still unknown');

    rerender(<SubcategoryDialog locale="en" parent={parent} pending={false} ambiguous onClose={vi.fn()} onClearAmbiguous={clear} onRetry={retry} onRefresh={vi.fn()} onSubmit={vi.fn()} />);
    await user.click(within(dialog).getByRole('button', { name: 'Retry unchanged subcategory' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Subcategory created');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus());
  });

  it('provides equivalent Arabic controls and closes safely with Escape', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<SubcategoryDialog locale="ar" parent={parent} pending={false} ambiguous={false} onClose={close} onClearAmbiguous={vi.fn()} onRetry={vi.fn()} onRefresh={vi.fn()} onSubmit={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'إنشاء فئة فرعية' });
    expect(within(dialog).getAllByText('الأساسيات').every((value) => value.closest('bdi') !== null)).toBe(true);
    expect(within(dialog).getByLabelText('الاسم بالإنجليزية')).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });
});
