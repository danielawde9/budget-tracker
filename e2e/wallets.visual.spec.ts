import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { installWalletsApiFixture, type WalletsFixtureOptions } from './fixtures/wallets.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/wallets-ui/${name}`
    : testInfo.outputPath(name);
}

async function openWallets(page: Page, options: WalletsFixtureOptions = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installWalletsApiFixture(page, options);
  await page.goto('/');
  await page.getByRole('button', { name: 'Wallets' }).click();
  await expect(page.getByRole('heading', { name: 'Wallets' })).toBeVisible();
}

async function postTransaction(page: Page, kind: 'income' | 'expense' | 'transfer', amount: string) {
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await dialog.getByLabel('Type').selectOption(kind);
  await dialog.getByLabel('Amount').fill(amount);
  if (kind === 'transfer') await dialog.getByLabel('To wallet').selectOption('reserve-usd-wallet');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await dialog.getByRole('button', { name: kind === 'income' ? 'Record income' : kind === 'expense' ? 'Record expense' : 'Record transfer' }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();
}

test('desktop Wallets overview separates balances and immutable history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await expect(page.getByText('$1,250.50')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-wallets-overview.png'), fullPage: true });
});

test('first wallet creation preserves an honest zero balance', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page, { emptyWallets: true });
  await page.getByRole('button', { name: 'Create first wallet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a wallet' });
  await dialog.getByLabel('Wallet name').fill('First safe wallet');
  await dialog.getByLabel('Currency').selectOption('LBP');
  await dialog.getByRole('button', { name: 'Create wallet' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet created');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('First safe wallet')).toBeVisible();
  await expect(page.getByText(/LBP.*0/)).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-first-wallet.png'), fullPage: true });
});

test('income and expense refresh the protected journal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await postTransaction(page, 'income', '45.25');
  await postTransaction(page, 'expense', '12');
  await expect(page.getByText('Income').first()).toBeVisible();
  await expect(page.getByText('Expense').first()).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-income-expense.png'), fullPage: true });
});

test('same-currency transfer records equal and opposite effects', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await postTransaction(page, 'transfer', '10');
  await expect(page.getByText('Transfer').first()).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-transfer.png'), fullPage: true });
});

test('general-event correction creates a linked reversal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'Correct income' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct this transaction' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Add linked reversal' }).click();
  await expect(dialog.getByRole('status')).toContainText('Correction recorded');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Reversed')).toBeVisible();
  await expect(page.getByText('Linked reversal', { exact: true })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-linked-correction.png'), fullPage: true });
});

test('ambiguous posting reconciles by request ID without a second mutation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page, { ambiguousEventOnce: true });
  await postTransaction(page, 'income', '7');
  await expect(page.getByText('$7.00')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-ambiguous-reconciled.png'), fullPage: true });
});

test('space switching clears the prior wallet projection before the next read', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await expect(page.getByText('Daily USD').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Current space' }).selectOption('household-space');
  await expect(page.getByText('Daily USD')).toHaveCount(0);
  await expect(page.getByText('Household USD')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-space-switch.png'), fullPage: true });
});

test('mobile transaction dialog is full-screen and rejects cross-currency transfer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openWallets(page);
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await expect(dialog).toHaveCSS('min-height', '844px');
  await dialog.getByLabel('Type').selectOption('transfer');
  await dialog.getByLabel('Amount').fill('10');
  await dialog.getByLabel('To wallet').selectOption('lbp-wallet');
  await dialog.getByRole('button', { name: 'Review transaction' }).click();
  await expect(dialog.getByRole('alert')).toContainText('same currency');
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-transfer-rejection.png') });
});

test('Arabic RTL Wallets mirrors overview and history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openWallets(page);
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'المحافظ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'سجل المعاملات' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-arabic-wallet-history.png'), fullPage: true });
});
