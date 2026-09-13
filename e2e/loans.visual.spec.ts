import { expect, test, type TestInfo } from '@playwright/test';
import { installLoansApiFixture } from './fixtures/loans.js';
import { expectDialogReturnsFocus } from './workspace-contract.js';
import { chooseWorkspaceDestination, switchWorkspaceLanguage, switchWorkspaceSpace } from './workspace-navigation.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/loans-ui/${name}`
    : testInfo.outputPath(name);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installLoansApiFixture(page);
  await page.goto('/');
  await chooseWorkspaceDestination(page, 'Loans');
  await expect(page.getByText('Maya')).toBeVisible();
});

test('loan creation and detail dialogs return focus to their opener', async ({ page }) => {
  await expectDialogReturnsFocus(page, page.getByRole('button', { name: 'Add loan' }), 'Add a loan');
  await expectDialogReturnsFocus(page, page.getByRole('button', { name: 'Open Karim loan' }), 'Karim loan details');
});

for (const [action, title] of [
  ['Record repayment', 'Record repayment to Karim'],
  ['Change monthly target', 'Monthly target for Karim'],
  ['Correct borrowing entry from Jun 1, 2026', 'Correct this ledger entry'],
] as const) {
  test(`closing ${title} returns focus to its detail action`, async ({ page }) => {
    await page.getByRole('button', { name: 'Open Karim loan' }).click();
    await expectDialogReturnsFocus(page, page.getByRole('button', { name: action, exact: true }), title);
  });
}

test('desktop English overview and immutable detail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await expect(page.getByTestId('summary-USD')).toContainText('Still reserved');
  await expect(page.getByRole('heading', { name: 'They owe me' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-en-overview.png'), fullPage: true });

  await page.getByRole('button', { name: 'Open Karim loan' }).click();
  await expect(page.getByRole('dialog', { name: 'Karim loan details' })).toContainText('Ledger history');
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-en-detail.png'), fullPage: true });
});

test('loan history correction actions name borrowing repayments in English and Arabic', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.getByRole('button', { name: 'Open Karim loan' }).click();
  let detail = page.getByRole('dialog', { name: 'Karim loan details' });
  await expect(detail.getByRole('button', { name: 'Correct borrowing entry from Jun 1, 2026' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Correct borrowing repayment from Sep 3, 2026' })).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();

  await switchWorkspaceLanguage(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await chooseWorkspaceDestination(page, 'القروض');
  await page.getByRole('button', { name: 'فتح قرض Karim' }).click();
  detail = page.getByRole('dialog', { name: 'تفاصيل قرض Karim' });
  await expect(detail.getByRole('button', { name: 'تصحيح قرض اقتراض بتاريخ ١ حزيران ٢٠٢٦' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'تصحيح دفعة سداد قرض بتاريخ ٣ أيلول ٢٠٢٦' })).toBeVisible();
});

test('mobile English creation and repayment overlays', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.getByRole('button', { name: 'Add loan' }).click();
  const create = page.getByRole('dialog', { name: 'Add a loan' });
  await expect(create).toBeVisible();
  await expect(create).toHaveCSS('min-height', '844px');
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-en-create.png') });
  await create.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Open Maya loan' }).click();
  await page.getByRole('button', { name: 'Receive repayment' }).click();
  await expect(page.getByRole('dialog', { name: 'Receive repayment from Maya' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-en-repayment.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('desktop Arabic household workspace mirrors the ledger', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await switchWorkspaceLanguage(page);
  await switchWorkspaceSpace(page, 'المساحة الحالية: My money', 'التبديل إلى Home budget');
  await chooseWorkspaceDestination(page, 'القروض');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'المساحة الحالية: Home budget' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-ar-household.png'), fullPage: true });
});

test('mobile Arabic overdue correction rejection explains recovery', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await switchWorkspaceLanguage(page);
  await chooseWorkspaceDestination(page, 'القروض');
  await page.getByRole('button', { name: 'فتح قرض Karim' }).click();
  await page.getByRole('button', { name: /تصحيح قرض/ }).click();
  const correction = page.getByRole('dialog', { name: 'تصحيح هذا القيد' });
  await correction.getByRole('checkbox').check();
  await correction.getByRole('button', { name: 'إضافة القيد العكسي' }).click();
  await expect(correction).toContainText('تعتمد دفعات لاحقة على هذا القيد');
  await expect(correction).toContainText('اعكس الدفعات اللاحقة أولًا');
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-ar-correction-error.png') });
});

test('mobile English overpayment keeps the entered amount and recovery', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.getByRole('button', { name: 'Open Maya loan' }).click();
  await page.getByRole('button', { name: 'Receive repayment' }).click();
  const repayment = page.getByRole('dialog', { name: 'Receive repayment from Maya' });
  await repayment.getByLabel('Repayment amount').fill('800');
  await repayment.getByRole('button', { name: 'Receive $800.00' }).click();
  await expect(repayment).toContainText('Amount is above the remaining loan');
  await expect(repayment.getByLabel('Repayment amount')).toHaveValue('800');
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-en-overpayment-error.png') });
});

test('all visible controls meet the minimum touch target', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  const tooSmall = await page.locator('button:visible, input:visible, select:visible').evaluateAll((elements) =>
    elements.filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width < 44 || box.height < 44;
    }).map((element) => ({ tag: element.tagName, text: element.textContent, label: element.getAttribute('aria-label') })),
  );
  expect(tooSmall).toEqual([]);
});
