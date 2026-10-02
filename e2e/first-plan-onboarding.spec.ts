import { expect, test } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';

async function capturePlan(page: import('@playwright/test').Page, path: string) {
  const original = page.viewportSize()!;
  await page.locator('.onboarding-overlay').evaluate(element => element.scrollTo(0, 0));
  await page.screenshot({ path: path.replace('.png', '-viewport.png') });
  const height = await page.locator('.onboarding-dialog').evaluate(element => element.scrollHeight);
  await page.setViewportSize({ width: original.width, height: Math.max(original.height, height + 48) });
  await page.screenshot({ path, scale: 'css' });
  await page.setViewportSize(original);
}

async function startPlan(page: import('@playwright/test').Page, mobile: boolean) {
  await installApplicationFixture(page, { emptySpaces: true });
  await page.goto('/');
  await page.getByLabel('Space name').fill('My money');
  if (mobile) {
    await page.getByLabel('Wallet name').fill('Cash');
    await page.getByRole('button', { name: 'Create space and wallet' }).click();
  } else {
    await page.getByRole('button', { name: 'Create personal space' }).click();
    await page.getByLabel('Wallet name').fill('Cash');
    await page.getByRole('button', { name: 'Create USD wallet' }).click();
  }
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByLabel('Monthly income')).toBeEnabled();
}

test('first plan links money and percentages, saves protected targets, and fits desktop and mobile', async ({ page }, testInfo) => {
  await startPlan(page, testInfo.project.name === 'mobile');
  await page.getByLabel('Monthly income').fill('2500');
  await page.getByLabel('Rent & bills amount').fill('900');
  await page.getByLabel('Groceries % of income').fill('14');
  await page.getByLabel('Transport amount').fill('150');
  await page.getByLabel('Personal spending amount').fill('200');
  await expect(page.getByLabel('Groceries amount')).toHaveValue('350');
  await expect(page.getByLabel('Rent & bills % of income')).toHaveValue('36');
  await expect(page.getByTestId('first-plan-remaining')).toContainText('$900.00');
  await expect(page.getByTestId('first-plan-remaining')).toContainText('36%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const screenshots = `artifacts/first-plan-onboarding/plan-${testInfo.project.name}.png`;
  await capturePlan(page, screenshots);
  const targets: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/rpc/set_monthly_category_target')) targets.push(request.postDataJSON());
  });
  await page.getByRole('button', { name: 'Create my plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  expect(targets.map(target => target['p_amount_minor'])).toEqual(['90000', '35000', '15000', '20000']);
  expect(targets.every(target => target['p_currency'] === 'USD')).toBe(true);
});

test('unfinished plan resumes after reload and the Arabic narrow layout stays contained', async ({ page }, testInfo) => {
  await startPlan(page, testInfo.project.name === 'mobile');
  await page.getByLabel('Monthly income').fill('2500');
  await page.getByLabel('Groceries amount').fill('350');
  await page.reload();
  await expect(page.getByLabel('Monthly income')).toHaveValue('2500');
  await expect(page.getByLabel('Groceries amount')).toHaveValue('350');
  await expect(page.getByLabel('Monthly income')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Record opening balance' })).toHaveCount(0);
  await page.getByRole('button', { name: 'العربية' }).click();
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 700 });
  await page.getByLabel('الدخل الشهري').fill('٢٥٠٠');
  await page.getByLabel('البقالة ٪ من الدخل').fill('١٤');
  await expect(page.getByLabel('البقالة المبلغ')).toHaveValue('350');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capturePlan(page, `artifacts/first-plan-onboarding/plan-ar-${testInfo.project.name}.png`);
  await page.getByRole('button', { name: 'سأخطط لاحقًا' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'الرئيسية' })).toBeVisible();
});
