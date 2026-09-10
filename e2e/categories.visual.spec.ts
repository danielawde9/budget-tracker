import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { installCategoriesApiFixture, type CategoriesFixtureOptions } from './fixtures/categories.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/categories-ui/${name}`
    : testInfo.outputPath(name);
}

async function openCategories(page: Page, options: CategoriesFixtureOptions = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installCategoriesApiFixture(page, options);
  await page.goto('/');
  await page.getByRole('button', { name: 'Categories' }).click();
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  if (!options.failCategoriesOnce) {
    await expect(page.getByRole('status', { name: 'Loading categories' })).toHaveCount(0);
  }
}

async function expectMinimumControlSize(scope: Locator) {
  const controls = scope.locator('button:visible, input:visible:not([type=radio]):not([type=checkbox]), select:visible, label:has(input:visible)');
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const box = await controls.nth(index).boundingBox();
    expect(box, `control ${index} must have a box`).not.toBeNull();
    expect(box!.width, `control ${index} must expose a 44px-wide target`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `control ${index} must expose a 44px-tall target`).toBeGreaterThanOrEqual(44);
  }
}

test('desktop category register separates active income and expense labels', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page);
  await expect(page.getByRole('heading', { name: 'Income categories' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Expense categories' })).toBeVisible();
  await expect(page.getByText('Salary').locator('xpath=ancestor-or-self::bdi')).toBeVisible();
  await expect(page.getByText('Essentials').locator('xpath=ancestor-or-self::bdi')).toBeVisible();
  await expect(page.getByText('Groceries').locator('xpath=ancestor-or-self::bdi')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Subcategories of Essentials' })).toContainText('Groceries');
  await expect(page.getByRole('button', { name: 'Archive Essentials' })).toHaveCount(0);
  await expect(page.getByText('Archive subcategories first')).toBeVisible();
  await expect(page.getByText('Archived travel')).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-category-register.png'), fullPage: true });
});

test('subcategory create and archive stay beneath the immutable selected root', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page);
  const opener = page.getByRole('button', { name: 'New subcategory for Essentials' });
  await opener.click();
  const createDialog = page.getByRole('dialog', { name: 'Create a subcategory' });
  await expect(createDialog.getByText('Essentials').first()).toBeVisible();
  await createDialog.getByLabel('English name').fill('Transport');
  await createDialog.getByLabel('Arabic name').fill('مواصلات');
  await createDialog.getByRole('button', { name: 'Create subcategory' }).click();
  await expect(createDialog.getByRole('status')).toContainText('Subcategory created');
  await createDialog.getByRole('button', { name: 'Done' }).click();

  const children = page.getByRole('list', { name: 'Subcategories of Essentials' });
  await expect(children.getByText('Transport')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-subcategory-register.png'), fullPage: true });
  await children.getByRole('button', { name: 'Archive Transport' }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'Archive category' });
  await archiveDialog.getByRole('checkbox').check();
  await archiveDialog.getByRole('button', { name: 'Archive category' }).click();
  await expect(archiveDialog.getByRole('status')).toContainText('Category archived');
  await archiveDialog.getByRole('button', { name: 'Done' }).click();
  await expect(children.getByText('Transport')).toHaveCount(0);
});

test('ambiguous subcategory creation reconciles without a duplicate child', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page, { ambiguousSubcategoryOnce: true });
  await page.getByRole('button', { name: 'New subcategory for Essentials' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a subcategory' });
  await dialog.getByLabel('English name').fill('Utilities');
  await dialog.getByRole('button', { name: 'Create subcategory' }).click();
  await expect(dialog.getByRole('status')).toContainText('Subcategory created');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('list', { name: 'Subcategories of Essentials' }).getByText('Utilities')).toHaveCount(1);
});

test('category create and archive refresh only the active register', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page);
  const opener = page.getByRole('button', { name: 'New category' });
  await opener.click();
  const createDialog = page.getByRole('dialog', { name: 'Create a category' });
  await expect(createDialog.getByLabel('English name')).toBeFocused();
  await createDialog.getByLabel('Type').selectOption('expense');
  await createDialog.getByLabel('English name').fill('Transport');
  await createDialog.getByLabel('Arabic name').fill('مواصلات');
  await createDialog.getByRole('button', { name: 'Create category' }).click();
  await expect(createDialog.getByRole('status')).toContainText('Category created');
  await createDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Transport')).toBeVisible();

  await page.getByRole('button', { name: 'Archive Transport' }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'Archive category' });
  await archiveDialog.getByRole('checkbox').check();
  await archiveDialog.getByRole('button', { name: 'Archive category' }).click();
  await expect(archiveDialog.getByRole('status')).toContainText('Category archived');
  await archiveDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Transport')).toHaveCount(0);
});

test('ambiguous category creation reconciles through its request result', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page, { ambiguousCategoryOnce: true });
  await page.getByRole('button', { name: 'New category' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a category' });
  await dialog.getByLabel('English name').fill('Consulting');
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(dialog.getByRole('status')).toContainText('Category created');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Consulting')).toHaveCount(1);
});

test('category rejection preserves safe bilingual form values', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page, { rejectCategoryCreateOnce: true });
  await page.getByRole('button', { name: 'New category' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a category' });
  await dialog.getByLabel('English name').fill('Salary');
  await dialog.getByLabel('Arabic name').fill('راتب');
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already');
  await expect(dialog.getByLabel('English name')).toHaveValue('Salary');
  await expect(dialog.getByLabel('Arabic name')).toHaveValue('راتب');
});

test('categorized and uncategorized income preserve exact history labels', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page);
  await page.getByRole('button', { name: 'Wallets' }).click();
  await page.getByRole('button', { name: 'Add transaction' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await dialog.getByRole('radio', { name: 'Salary' }).check();
  await dialog.getByLabel('Effective date').fill('2026-09-08');
  await dialog.getByLabel('Amount').fill('45.25');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await expect(dialog.getByRole('region', { name: 'Wallet effect preview' })).toContainText('Category Salary');
  await dialog.getByRole('button', { name: 'Record income' }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Salary').last()).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-categorized-history.png') });

  await page.getByRole('button', { name: 'Add transaction' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await expect(dialog.getByRole('radio', { name: 'Uncategorized' })).toBeChecked();
  await dialog.getByLabel('Amount').fill('7');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await dialog.getByRole('button', { name: 'Record income' }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Uncategorized').first()).toBeVisible();
});

test('a child category posts its exact identity without changing signed minor units', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page);
  await page.getByRole('button', { name: 'Wallets' }).click();
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await dialog.getByLabel('Type').selectOption('expense');
  const children = dialog.getByRole('group', { name: 'Subcategories of Essentials' });
  await children.getByRole('radio', { name: 'Groceries' }).check();
  await dialog.getByLabel('Effective date').fill('2026-09-10');
  await dialog.getByLabel('Amount').fill('12.50');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await expect(dialog.getByRole('region', { name: 'Wallet effect preview' })).toContainText('Category Groceries');
  await expect(dialog.getByRole('region', { name: 'Wallet effect preview' })).toContainText('$12.50');
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-subcategory-picker.png') });
  await dialog.getByRole('button', { name: 'Record expense' }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Groceries').last()).toBeVisible();
  await expect(page.getByText('-$12.50')).toBeVisible();
});

test('archived historical label remains while ambiguity reconciles without duplicate posts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page, { ambiguousCategorizedEventOnce: true });
  await page.getByRole('button', { name: 'Wallets' }).click();
  await expect(page.getByText('Archived travel')).toBeVisible();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await dialog.getByRole('radio', { name: 'Salary' }).check();
  await dialog.getByLabel('Amount').fill('9');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await dialog.getByRole('button', { name: 'Record income' }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('$9.00')).toHaveCount(1);
});

test('category load failure offers a deterministic manager retry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openCategories(page, { failCategoriesOnce: true });
  const error = page.getByRole('alert');
  await expect(error).toContainText('Categories are unavailable', { timeout: 15_000 });
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Salary')).toBeVisible();
});

test('mobile category tabs and dialog remain contained with accessible targets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openCategories(page);
  await expect(page.getByRole('group', { name: 'Category type' })).toBeVisible();
  await page.getByRole('button', { name: 'Expense', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Subcategories of Essentials' })).toContainText('Groceries');
  await page.getByRole('button', { name: 'New category' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a category' });
  await expect(dialog).toHaveCSS('min-height', '844px');
  await expectMinimumControlSize(dialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-create-category.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New category' })).toBeFocused();
  await page.getByRole('button', { name: 'New subcategory for Essentials' }).click();
  const subcategoryDialog = page.getByRole('dialog', { name: 'Create a subcategory' });
  await expect(subcategoryDialog).toHaveCSS('min-height', '844px');
  await expectMinimumControlSize(subcategoryDialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-create-subcategory.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Wallets' }).click();
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const transactionDialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await expectMinimumControlSize(transactionDialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Arabic RTL mirrors management and categorized history with isolated names', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openCategories(page);
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الفئات' })).toBeVisible();
  await expect(page.getByText('راتب').locator('xpath=ancestor-or-self::bdi')).toBeVisible();
  await page.getByRole('button', { name: 'المصروف', exact: true }).click();
  await expect(page.getByRole('list', { name: 'الفئات الفرعية ضمن الأساسيات' })).toContainText('بقالة');
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-arabic-category-register.png') });
  await page.getByRole('button', { name: 'المحافظ' }).click();
  const historyHeading = page.getByRole('heading', { name: 'سجل المعاملات' });
  await expect(historyHeading).toBeVisible();
  const archivedCategory = page.getByText('سفر مؤرشف').locator('xpath=ancestor-or-self::bdi');
  await expect(archivedCategory).toBeVisible();
  await historyHeading.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-arabic-categorized-history.png') });
});
