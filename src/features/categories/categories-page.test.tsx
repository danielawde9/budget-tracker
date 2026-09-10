import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { CategoriesPage } from './categories-page.js';
import type { CategoryKind } from './types.js';

class PagedCategoriesGateway extends InMemoryCategoriesGateway {
  failNextPage = true;

  override async listCategories(spaceId: string, kind: CategoryKind, cursor?: string) {
    this.calls.push({ name: 'listCategories', input: { spaceId, kind, cursor } });
    if (kind === 'expense') return { categories: this.categories.filter((category) => category.kind === kind), nextCursor: null };
    if (!cursor) return { categories: this.categories.filter((category) => category.kind === kind), nextCursor: 'income-next' };
    if (this.failNextPage) throw new Error('Network unavailable');
    return {
      categories: [{ ...this.categories[0]!, id: 'category-bonus', nameEn: 'Bonus' }],
      nextCursor: null,
    };
  }
}

async function renderPage(gateway = new InMemoryCategoriesGateway(), locale: 'en' | 'ar' = 'en') {
  const user = userEvent.setup();
  render(<CategoriesPage gateway={gateway} spaceId="space-1" locale={locale} onSpaceUnavailable={vi.fn()} />);
  await waitFor(() => expect(screen.queryByRole('status', { name: /Loading categories|تحميل الفئات/i })).not.toBeInTheDocument());
  return { gateway, user };
}

describe('CategoriesPage', () => {
  it('renders separate active income and expense registers with stored names isolated', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Income categories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expense categories' })).toBeInTheDocument();
    expect(screen.getAllByText('Salary').every((element) => element.closest('bdi') !== null)).toBe(true);
    expect(screen.getAllByText('بقالة').every((element) => element.closest('bdi') !== null)).toBe(true);
    expect(screen.queryByRole('button', { name: /rename|delete|unarchive|icon|color/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New subcategory for Salary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New subcategory for Groceries' })).toBeInTheDocument();
  });

  it('nests active children under roots and requires child archival before parent archival', async () => {
    const gateway = new InMemoryCategoriesGateway();
    gateway.categories.push({
      id: 'category-food', spaceId: 'space-1', kind: 'expense', nameEn: 'Food', nameAr: 'طعام',
      parentCategoryId: 'category-groceries', createdAt: '2026-09-08T12:00:00Z', archivedAt: null,
    });
    await renderPage(gateway);

    const children = screen.getByRole('list', { name: 'Subcategories of Groceries' });
    expect(within(children).getByText('Food').closest('bdi')).not.toBeNull();
    expect(within(children).getByRole('button', { name: 'Archive Food' })).toBeInTheDocument();
    expect(within(children).queryByRole('button', { name: 'New subcategory for Food' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive Groceries' })).not.toBeInTheDocument();
    expect(screen.getByText('Archive subcategories first')).toBeInTheDocument();
  });

  it('creates a child for the immutable selected root and restores opener focus', async () => {
    const { gateway, user } = await renderPage();
    const opener = screen.getByRole('button', { name: 'New subcategory for Groceries' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create a subcategory' });
    await user.type(within(dialog).getByLabelText('English name'), 'Transport');
    await user.click(within(dialog).getByRole('button', { name: 'Create subcategory' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Subcategory created');
    expect(gateway.calls).toContainEqual({
      name: 'createSubcategory',
      input: expect.objectContaining({ parentCategoryId: 'category-groceries', nameEn: 'Transport' }),
    });
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    expect(screen.getByRole('list', { name: 'Subcategories of Groceries' })).toHaveTextContent('Transport');
  });

  it('creates and archives through server-refetched active rows', async () => {
    const { gateway, user } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'New category' }));
    let dialog = screen.getByRole('dialog', { name: 'Create a category' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'expense');
    await user.type(within(dialog).getByLabelText('English name'), 'Transport');
    await user.click(within(dialog).getByRole('button', { name: 'Create category' }));
    await within(dialog).findByText('Category created');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Transport')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive Transport' }));
    dialog = screen.getByRole('dialog', { name: 'Archive category' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Archive category' }));
    await within(dialog).findByText('Category archived');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Transport')).not.toBeInTheDocument());
    expect(gateway.calls.some((call) => call.name === 'archiveCategory')).toBe(true);
  });

  it('shows independent empty guidance', async () => {
    const gateway = new InMemoryCategoriesGateway();
    gateway.categories = [];
    await renderPage(gateway);
    expect(screen.getByText('No income categories yet')).toBeInTheDocument();
    expect(screen.getByText('No expense categories yet')).toBeInTheDocument();
  });

  it('recovers from a load error', async () => {
    cleanup();
    const gateway = new InMemoryCategoriesGateway();
    gateway.error = new Error('Network unavailable');
    const user = userEvent.setup();
    render(<CategoriesPage gateway={gateway} spaceId="space-1" locale="en" onSpaceUnavailable={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('category request was not accepted');
    gateway.error = null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Salary')).toBeInTheDocument();
  });

  it('keeps loaded rows and offers a kind-specific retry after a later page fails', async () => {
    const gateway = new PagedCategoriesGateway();
    const { user } = await renderPage(gateway);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('category request was not accepted');
    expect(screen.getByText('Salary')).toBeInTheDocument();

    gateway.failNextPage = false;
    await user.click(screen.getByRole('button', { name: 'Retry loading income categories' }));
    expect(await screen.findByText('Bonus')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not offer root archival until the kind is fully loaded', async () => {
    const gateway = new PagedCategoriesGateway();
    gateway.failNextPage = false;
    const { user } = await renderPage(gateway);

    expect(screen.queryByRole('button', { name: 'Archive Salary' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: 'Archive Salary' })).toBeInTheDocument();
  });

  it('localizes initial membership and repeated next-page failures in Arabic', async () => {
    cleanup();
    const inaccessible = new InMemoryCategoriesGateway();
    inaccessible.error = new Error('an active space membership is required');
    render(<CategoriesPage gateway={inaccessible} spaceId="space-1" locale="ar" onSpaceUnavailable={vi.fn()} />);
    let alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('لم يعد لديك وصول إلى هذه المساحة');
    expect(alert).not.toHaveTextContent('You no longer have access');

    cleanup();
    const paged = new PagedCategoriesGateway();
    const user = userEvent.setup();
    render(<CategoriesPage gateway={paged} spaceId="space-1" locale="ar" onSpaceUnavailable={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'تحميل الفئات' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'تحميل المزيد' }));
    alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('لم يتم قبول طلب الفئة');
    expect(alert).not.toHaveTextContent('category request was not accepted');
    await user.click(screen.getByRole('button', { name: 'إعادة محاولة تحميل فئات الدخل' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('لم يتم قبول طلب الفئة');
  });

  it('renders equivalent Arabic management and restores opener focus after Escape', async () => {
    const { user } = await renderPage(new InMemoryCategoriesGateway(), 'ar');
    expect(screen.getByRole('heading', { name: 'الفئات' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'فئات الدخل' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'فئة فرعية جديدة ضمن راتب' })).toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'فئة جديدة' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'إنشاء فئة' });
    await user.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('restores opener focus when Escape closes a create success state', async () => {
    const { user } = await renderPage();
    const opener = screen.getByRole('button', { name: 'New category' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create a category' });
    await user.type(within(dialog).getByLabelText('English name'), 'Consulting');
    await user.click(within(dialog).getByRole('button', { name: 'Create category' }));
    await within(dialog).findByRole('status');
    await user.keyboard('{Escape}');

    expect(dialog).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
