import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryCategoriesGateway } from '../../test/in-memory-categories-gateway.js';
import { CategoriesPage } from './categories-page.js';

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
    expect(screen.queryByRole('button', { name: /rename|delete|unarchive|subcategory|icon|color/i })).not.toBeInTheDocument();
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

  it('renders equivalent Arabic management and restores opener focus after Escape', async () => {
    const { user } = await renderPage(new InMemoryCategoriesGateway(), 'ar');
    expect(screen.getByRole('heading', { name: 'الفئات' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'فئات الدخل' })).toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'فئة جديدة' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'إنشاء فئة' });
    await user.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
