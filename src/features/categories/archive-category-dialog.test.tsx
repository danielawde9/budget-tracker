import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Category } from './types.js';
import { ArchiveCategoryDialog } from './archive-category-dialog.js';

const category: Category = {
  id: 'category-1', spaceId: 'space-1', kind: 'expense', nameEn: 'Groceries', nameAr: 'بقالة',
  createdAt: '2026-09-08T10:00:00Z', archivedAt: null,
};

describe('ArchiveCategoryDialog', () => {
  it('requires deliberate confirmation, isolates stored names, and never offers deletion', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => ({ status: 'success' as const, reconciled: false }));
    render(<ArchiveCategoryDialog locale="en" category={category} pending={false} ambiguous={false} onClose={vi.fn()} onRetry={vi.fn()} onSubmit={save} />);
    const dialog = screen.getByRole('dialog', { name: 'Archive category' });
    expect(within(dialog).getByText('Groceries').closest('bdi')).not.toBeNull();
    expect(within(dialog).queryByRole('button', { name: /delete|unarchive/i })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Archive category' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Confirm that new transactions');
    expect(save).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Archive category' }));
    expect(save).toHaveBeenCalledOnce();
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Category archived');
  });

  it('keeps the dialog recoverable after a rejection', async () => {
    const user = userEvent.setup();
    render(<ArchiveCategoryDialog locale="ar" category={category} pending={false} ambiguous={false} onClose={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn(async () => { throw { code: 'P0001', message: 'the category is already archived' }; })} />);
    const dialog = screen.getByRole('dialog', { name: 'أرشفة الفئة' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'أرشفة الفئة' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('مؤرشفة بالفعل');
    expect(dialog).toBeInTheDocument();
  });
});
