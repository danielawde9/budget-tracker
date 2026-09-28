import { expect, test, type Page, type Route } from '@playwright/test';

import { installCategoriesApiFixture } from './fixtures/categories.js';
import { chooseWorkspaceDestination } from './workspace-navigation.js';

async function openCategories(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installCategoriesApiFixture(page);
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Loading financial overview' })).toHaveCount(0);
  await chooseWorkspaceDestination(page, 'Categories');
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading categories' })).toHaveCount(0);
}

test('suggestion pack is explicit opt-in and adds only the chosen labels', async ({ page }) => {
  await openCategories(page);

  await page.getByRole('button', { name: 'Add suggestion pack' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add suggestion pack' });
  // Every suggestion is previewed, and none is opted in by default.
  await expect(dialog.getByRole('group', { name: 'Housing' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Food' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Include Housing' })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Include Food' })).not.toBeChecked();

  await dialog.getByRole('checkbox', { name: 'Include Housing' }).check();
  await dialog.getByRole('checkbox', { name: 'Include Food' }).check();
  // The label is editable and normalized through the existing category rules.
  await dialog.getByRole('group', { name: 'Housing' }).getByLabel('English name').fill('Rent');
  await dialog.getByRole('button', { name: 'Add selected categories' }).click();
  await expect(dialog.getByRole('status')).toContainText('2 created');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByText('Rent', { exact: true })).toBeVisible();
  await expect(page.getByText('Food', { exact: true })).toBeVisible();
  // The suggestions that were not opted in were never created.
  await expect(page.getByText('Transport', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Dining', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Leisure', { exact: true })).toHaveCount(0);
});

test('a partial failure reports created and failed, then retries only that label with its same request UUID', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installCategoriesApiFixture(page);
  const calls: { name: string | null; requestId: string }[] = [];
  // Fail exactly the second create-category command with a non-category
  // rejection, so the entry is unresolved (retryable) rather than a collision.
  await page.route('**/rpc/create_category', async (route: Route) => {
    const body = route.request().postDataJSON() as { p_request_id: string; p_name_en: string | null };
    calls.push({ name: body.p_name_en, requestId: body.p_request_id });
    if (calls.length === 2) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ message: 'the category request could not be accepted for this check', code: 'P0001' }),
      });
    }
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Loading financial overview' })).toHaveCount(0);
  await chooseWorkspaceDestination(page, 'Categories');
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading categories' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add suggestion pack' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add suggestion pack' });
  await dialog.getByRole('checkbox', { name: 'Include Housing' }).check();
  await dialog.getByRole('checkbox', { name: 'Include Food' }).check();
  await dialog.getByRole('checkbox', { name: 'Include Transport' }).check();
  await dialog.getByRole('button', { name: 'Add selected categories' }).click();

  await expect(dialog.getByRole('status')).toContainText('2 created');
  await expect(dialog.getByRole('status')).toContainText('1 failed');
  expect(calls.map((call) => call.name)).toEqual(['Housing', 'Food', 'Transport']);

  await dialog.getByRole('button', { name: 'Retry failed categories' }).click();
  await expect(dialog.getByRole('status')).toContainText('3 created');
  await expect(dialog.getByRole('status')).toContainText('0 failed');

  // Only the failed entry was retried, and it reused the same request UUID.
  expect(calls.map((call) => call.name)).toEqual(['Housing', 'Food', 'Transport', 'Food']);
  expect(calls[3]!.requestId).toBe(calls[1]!.requestId);

  await dialog.getByRole('button', { name: 'Done' }).click();
  // No duplicates: each resolved label appears exactly once.
  for (const label of ['Housing', 'Food', 'Transport']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(1);
  }
});

test('a suggestion whose name already exists is skipped and never duplicated', async ({ page }) => {
  await openCategories(page);

  // Create an expense "Housing" through the normal control first.
  await page.getByRole('button', { name: 'New category', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create a category' });
  await create.getByRole('radio', { name: 'Expense' }).check();
  await create.getByLabel('English name').fill('Housing');
  await create.getByLabel('Arabic name').fill('السكن');
  await create.getByRole('button', { name: 'Create category' }).click();
  await expect(create.getByRole('status')).toContainText('Category created');
  await create.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Housing', { exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Add suggestion pack' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add suggestion pack' });
  await dialog.getByRole('checkbox', { name: 'Include Housing' }).check();
  await dialog.getByRole('checkbox', { name: 'Include Food' }).check();
  await dialog.getByRole('button', { name: 'Add selected categories' }).click();

  // The collision surfaces the existing category instead of a second Housing.
  await expect(dialog.getByRole('status')).toContainText('1 skipped');
  await expect(dialog.getByRole('status')).toContainText('1 created');
  await expect(dialog.getByText('Existing category')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByText('Housing', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Food', { exact: true })).toHaveCount(1);
});
