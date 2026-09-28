import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CategoryPack } from './category-packs.js';
import { CategoryPackDialog } from './category-pack-dialog.js';
import type { Category } from './types.js';
import type { CategoryCommandOutcome } from './use-categories.js';

const success: CategoryCommandOutcome = { status: 'success', reconciled: false };
const created: CategoryCommandOutcome = { status: 'success', reconciled: true };

function category(overrides: Partial<Category> & Pick<Category, 'id' | 'kind' | 'nameEn' | 'nameAr'>): Category {
  return {
    spaceId: 'space-1',
    parentCategoryId: null,
    createdAt: '2026-09-08T10:00:00Z',
    archivedAt: null,
    ...overrides,
  };
}

function renderDialog(overrides: Partial<Parameters<typeof CategoryPackDialog>[0]> = {}) {
  const onCreateCategory = overrides.onCreateCategory ?? vi.fn(async () => success);
  const onClose = overrides.onClose ?? vi.fn();
  const createRequestId = overrides.createRequestId ?? (() => globalThis.crypto.randomUUID());
  render(
    <CategoryPackDialog
      locale={overrides.locale ?? 'en'}
      existingCategories={overrides.existingCategories ?? []}
      onCreateCategory={onCreateCategory}
      createRequestId={createRequestId}
      onClose={onClose}
      {...(overrides.packs ? { packs: overrides.packs } : {})}
    />,
  );
  const user = userEvent.setup();
  const dialog = screen.getByRole('dialog', { name: overrides.locale === 'ar' ? 'إضافة حزمة اقتراحات' : 'Add suggestion pack' });
  /** Scope to one suggestion's fieldset (its legend is the suggestion label). */
  const group = (name: string) => within(within(dialog).getByRole('group', { name }));
  return { user, dialog, group, onCreateCategory, onClose };
}

describe('CategoryPackDialog', () => {
  it('previews every suggestion and creates only the explicitly selected, editable labels', async () => {
    const { user, dialog, group, onCreateCategory } = renderDialog({ createRequestId: () => 'req-housing' });

    for (const name of ['Housing', 'Food', 'Transport', 'Dining', 'Leisure']) {
      expect(within(dialog).getByRole('group', { name })).toBeInTheDocument();
    }
    // Explicit opt-in: nothing is selected and no command runs until confirm.
    expect(within(dialog).getByRole('checkbox', { name: 'Include Housing' })).not.toBeChecked();
    expect(onCreateCategory).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Housing' }));
    await user.clear(group('Housing').getByLabelText('English name'));
    await user.type(group('Housing').getByLabelText('English name'), '  Rent  ');
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));

    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 created'));
    expect(onCreateCategory).toHaveBeenCalledTimes(1);
    expect(onCreateCategory).toHaveBeenCalledWith({ kind: 'expense', nameEn: 'Rent', nameAr: 'السكن' }, 'req-housing');
  });

  it('normalizes edited labels through the existing category rules before submission', async () => {
    const { user, dialog, group, onCreateCategory } = renderDialog({ createRequestId: () => 'req-food' });

    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Food' }));
    await user.clear(group('Food').getByLabelText('English name'));
    await user.type(group('Food').getByLabelText('English name'), '   Food   ');
    await user.clear(group('Food').getByLabelText('Arabic name'));
    await user.type(group('Food').getByLabelText('Arabic name'), '  الطعام  ');
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));

    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 created'));
    expect(onCreateCategory).toHaveBeenCalledWith({ kind: 'expense', nameEn: 'Food', nameAr: 'الطعام' }, 'req-food');
  });

  it('requires at least one name and does not run on an empty selection', async () => {
    const { user, dialog, group, onCreateCategory } = renderDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Select at least one suggestion');

    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Dining' }));
    await user.clear(group('Dining').getByLabelText('English name'));
    await user.clear(group('Dining').getByLabelText('Arabic name'));
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at least one category name');
    expect(onCreateCategory).not.toHaveBeenCalled();
  });

  it('reports created and failed, then retries only the unresolved entry with its same request UUID', async () => {
    const requestIds: string[] = [];
    const order: string[] = [];
    const ids = ['req-housing', 'req-food'];
    const onCreateCategory = vi.fn(async (draft: { nameEn: string | null }, requestId: string) => {
      requestIds.push(requestId);
      order.push(`${draft.nameEn ?? ''}:${requestId}`);
      if (draft.nameEn === 'Housing' && order.filter((entry) => entry.startsWith('Housing:')).length === 1) {
        throw { code: 'P0001', message: 'the category request was not accepted' };
      }
      return success;
    }) as unknown as Parameters<typeof CategoryPackDialog>[0]['onCreateCategory'];

    const { user, dialog } = renderDialog({ onCreateCategory, createRequestId: () => ids.shift()! });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Housing' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Food' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));

    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 created'));
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 failed');
    expect(requestIds).toEqual(['req-housing', 'req-food']);

    await user.click(within(dialog).getByRole('button', { name: 'Retry failed categories' }));
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('2 created'));
    expect(within(dialog).getByRole('status')).toHaveTextContent('0 failed');
    // The unresolved entry reused its UUID; the created entry was never re-run.
    expect(requestIds).toEqual(['req-housing', 'req-food', 'req-housing']);
    expect(order).toEqual(['Housing:req-housing', 'Food:req-food', 'Housing:req-housing']);
  });

  it('skips a suggestion whose normalized name already exists and surfaces that category', async () => {
    const existing = category({ id: 'expense-housing', kind: 'expense', nameEn: 'Housing', nameAr: 'السكن' });
    const onCreateCategory = vi.fn(async () => success);
    const { user, dialog } = renderDialog({ existingCategories: [existing], onCreateCategory });

    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Housing' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));

    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 skipped'));
    expect(within(dialog).getByText('Existing category')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Housing').every((element) => element.closest('bdi') !== null)).toBe(true);
    expect(within(dialog).queryByRole('button', { name: 'Retry failed categories' })).not.toBeInTheDocument();
    expect(onCreateCategory).not.toHaveBeenCalled();
  });

  it('never merges an income category with an expense suggestion of the same name', async () => {
    const existing = category({ id: 'income-housing', kind: 'income', nameEn: 'Housing', nameAr: null });
    const onCreateCategory = vi.fn(async () => success);
    const { user, dialog } = renderDialog({ existingCategories: [existing], onCreateCategory, createRequestId: () => 'req-housing' });

    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Housing' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));

    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 created'));
    expect(onCreateCategory).toHaveBeenCalledWith({ kind: 'expense', nameEn: 'Housing', nameAr: 'السكن' }, 'req-housing');
  });

  it('treats a server-side duplicate as a skip, not a retryable failure', async () => {
    const onCreateCategory = vi.fn(async () => {
      throw { code: 'P0001', message: 'an active category already uses one of the supplied normalized names' };
    }) as unknown as Parameters<typeof CategoryPackDialog>[0]['onCreateCategory'];
    const { user, dialog } = renderDialog({ onCreateCategory });

    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Leisure' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));

    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 skipped'));
    expect(within(dialog).queryByRole('button', { name: 'Retry failed categories' })).not.toBeInTheDocument();
  });

  it('reconciles an ambiguous create as created without a retry', async () => {
    const onCreateCategory = vi.fn(async () => created);
    const { user, dialog } = renderDialog({ onCreateCategory });

    await user.click(within(dialog).getByRole('checkbox', { name: 'Include Leisure' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));

    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 created'));
    expect(onCreateCategory).toHaveBeenCalledTimes(1);
  });

  it('allows at most ten selected suggestions in one run', async () => {
    const bigPack: CategoryPack = {
      id: 'big',
      version: 1,
      nameEn: 'Big',
      nameAr: 'كبير',
      suggestions: Array.from({ length: 12 }, (_, index) => ({
        id: `big.${index}`,
        kind: 'expense' as const,
        nameEn: `Item ${index}`,
        nameAr: `بند ${index}`,
      })),
    };
    let sequence = 0;
    const onCreateCategory = vi.fn(async () => success);
    const { user, dialog } = renderDialog({ packs: [bigPack], onCreateCategory, createRequestId: () => `req-${sequence += 1}` });

    for (let index = 0; index < 10; index += 1) {
      await user.click(within(dialog).getByRole('checkbox', { name: `Include Item ${index}` }));
    }
    expect(within(dialog).getByRole('checkbox', { name: 'Include Item 10' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Add selected categories' }));
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('10 created'));
    expect(onCreateCategory).toHaveBeenCalledTimes(10);
  });

  it('provides equivalent Arabic controls with safe Escape close', async () => {
    const onClose = vi.fn();
    const { user, dialog } = renderDialog({ locale: 'ar', onClose });
    expect(within(dialog).getByRole('group', { name: 'السكن' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'تضمين السكن' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'إضافة الفئات المحددة' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
