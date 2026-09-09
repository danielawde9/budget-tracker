import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { installApplicationFixture } from './fixtures/application.js';

const requiredProtectedMutations = [
  'archive_category',
  'create_category',
  'create_wallet',
  'open_loan_outstanding',
  'record_cash_loan',
  'record_categorized_financial_event',
  'record_financial_event',
  'record_loan_repayment',
  'reverse_financial_event',
  'set_loan_monthly_target',
] as const;

async function fixtureAudit(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:55432/rest/v1/__fixture_audit');
    return { status: response.status, body: await response.json() as {
      boundary: string;
      authentication: string;
      database: string;
      payloadsRecorded: boolean;
      protectedMutationCalls: string[];
    } };
  });
}

async function finishWalletTransaction(page: Page, kind: 'opening_balance' | 'income' | 'expense' | 'transfer', amount: string) {
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await dialog.getByLabel('Type').selectOption(kind);
  await dialog.getByLabel('Amount').fill(amount);
  if (kind === 'transfer') await dialog.getByLabel('To wallet').selectOption('reserve-usd-wallet');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await dialog.getByRole('button', { name: `Record ${kind.replace('_', ' ')}` }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();
}

test('offline rehearsal exposes an explicit simulated-boundary receipt', async ({ page }) => {
  await installApplicationFixture(page);
  await page.goto('/');

  const receipt = await fixtureAudit(page);

  expect(receipt.status).toBe(200);
  expect(receipt.body).toMatchObject({
    boundary: 'simulated-local-http',
    authentication: 'injected-local-storage-session',
    database: 'in-memory-fixture-state',
  });
});

test('desktop English rehearsal exercises every protected financial mutation and retains fixture state on reload', async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page);
  await page.goto('/');

  await page.getByText('Account').click();
  await expect(page.getByRole('note', { name: 'Backup readiness' })).toContainText('Do not enter real financial data');
  await page.getByText('Account').click();

  await page.getByRole('button', { name: 'Wallets' }).click();
  await page.getByRole('button', { name: 'New wallet' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create a wallet' });
  await dialog.getByLabel('Wallet name').fill('Synthetic UAT wallet');
  await dialog.getByRole('button', { name: 'Create wallet' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet created');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Synthetic UAT wallet')).toBeVisible();

  await finishWalletTransaction(page, 'opening_balance', '20');
  await finishWalletTransaction(page, 'income', '7');
  await finishWalletTransaction(page, 'expense', '3');
  await finishWalletTransaction(page, 'transfer', '2');

  await page.getByRole('button', { name: 'Correct income' }).first().click();
  dialog = page.getByRole('dialog', { name: 'Correct this transaction' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Add linked reversal' }).click();
  await expect(dialog.getByRole('status')).toContainText('Correction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Categories' }).click();
  await page.getByRole('button', { name: 'New category' }).click();
  dialog = page.getByRole('dialog', { name: 'Create a category' });
  await dialog.getByLabel('Type').selectOption('expense');
  await dialog.getByLabel('English name').fill('Synthetic transport');
  await dialog.getByLabel('Arabic name').fill('نقل تجريبي');
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(dialog.getByRole('status')).toContainText('Category created');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Wallets' }).click();
  await page.getByRole('button', { name: 'Add transaction' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await dialog.getByLabel('Type').selectOption('expense');
  await dialog.getByRole('radio', { name: 'Synthetic transport' }).check();
  await dialog.getByLabel('Amount').fill('4.25');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await dialog.getByRole('button', { name: 'Record expense' }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Categories' }).click();
  await page.getByRole('button', { name: 'Archive Synthetic transport' }).click();
  dialog = page.getByRole('dialog', { name: 'Archive category' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Archive category' }).click();
  await expect(dialog.getByRole('status')).toContainText('Category archived');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Loans' }).click();
  await page.getByRole('button', { name: 'Add loan' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a loan' });
  await dialog.getByLabel('Person').fill('Synthetic opening');
  await dialog.getByLabel('Amount').fill('100');
  await dialog.getByRole('button', { name: 'Record opening' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Add loan' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a loan' });
  await dialog.getByRole('radio', { name: 'I lent money' }).check();
  await dialog.getByLabel('Person').fill('Synthetic cash loan');
  await dialog.getByLabel('Amount').fill('10');
  await dialog.getByRole('button', { name: 'Record lending' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Open Maya loan' }).click();
  await page.getByRole('button', { name: 'Receive repayment' }).click();
  dialog = page.getByRole('dialog', { name: 'Receive repayment from Maya' });
  await dialog.getByLabel('Repayment amount').fill('5');
  await dialog.getByRole('button', { name: 'Receive $5.00' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Open Karim loan' }).click();
  await page.getByRole('button', { name: 'Change monthly target' }).click();
  dialog = page.getByRole('dialog', { name: 'Monthly target for Karim' });
  await dialog.getByLabel('Target amount').fill('40');
  await dialog.getByRole('button', { name: 'Save target' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Open Karim loan' }).click();
  await page.getByRole('button', { name: /Correct borrowing entry/ }).click();
  dialog = page.getByRole('dialog', { name: 'Correct this ledger entry' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Add reversal' }).click();
  await expect(dialog.getByRole('alert')).toContainText('later repayments');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  const audit = await fixtureAudit(page);
  expect(audit.body.payloadsRecorded).toBe(false);
  expect(new Set(audit.body.protectedMutationCalls)).toEqual(new Set(requiredProtectedMutations));

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Loans' })).toBeVisible();
  await page.getByRole('button', { name: 'Wallets' }).click();
  await expect(page.getByText('Synthetic UAT wallet')).toBeVisible();
  const archivedSyntheticEvent = page.getByRole('listitem').filter({ hasText: 'Synthetic transport' }).first();
  await expect(archivedSyntheticEvent).toContainText('Archived');
  await page.screenshot({ path: testInfo.outputPath('desktop-en-reload-retention.png'), fullPage: true });
});

test('mobile Arabic rehearsal keeps the empty state, RTL, recovery notice, and synthetic wallet after reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await installApplicationFixture(page, { emptyWallets: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'المحافظ' }).click();
  await expect(page.getByText('لا توجد محافظ بعد')).toBeVisible();
  await page.getByRole('button', { name: 'إنشاء أول محفظة' }).click();
  const dialog = page.getByRole('dialog', { name: 'إنشاء محفظة' });
  await dialog.getByLabel('اسم المحفظة').fill('محفظة تجريبية');
  await dialog.getByRole('button', { name: 'إنشاء المحفظة' }).click();
  await expect(dialog.getByRole('status')).toContainText('تم إنشاء المحفظة');
  await dialog.getByRole('button', { name: 'تم' }).click();

  await page.reload();
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.getByRole('button', { name: 'المحافظ' }).click();
  await expect(page.getByText('محفظة تجريبية')).toBeVisible();
  await page.getByText('الحساب').click();
  await expect(page.getByRole('note', { name: 'جاهزية النسخ الاحتياطي' })).toContainText('لا تُدخل بيانات مالية حقيقية');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('mobile-ar-reload-retention.png'), fullPage: true });
});
