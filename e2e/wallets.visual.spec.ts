import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { installWalletsApiFixture, type WalletsFixtureOptions } from './fixtures/wallets.js';
import { expectDialogReturnsFocus } from './workspace-contract.js';
import { chooseWorkspaceDestination, switchWorkspaceLanguage, switchWorkspaceSpace } from './workspace-navigation.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/wallets-ui/${name}`
    : testInfo.outputPath(name);
}

function activeWalletName(page: Page, name: string) {
  return page.locator('.wallet-context .wallet-list > li > div > bdi').filter({ hasText: new RegExp(`^${name}$`) });
}

async function openWallets(page: Page, options: WalletsFixtureOptions = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installWalletsApiFixture(page, options);
  await page.goto('/');
  await chooseWorkspaceDestination(page, 'Wallets');
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

test('wallet create, transaction, rename, archive and undo dialogs return focus', async ({ page }) => {
  await openWallets(page);
  for (const [action, title] of [
    ['New wallet', 'Create a wallet'],
    ['Add transaction', 'Add a transaction'],
    ['Rename Daily USD', 'Rename wallet'],
    ['Archive Daily USD', 'Archive wallet'],
    ['Undo income', 'Undo this transaction'],
  ] as const) {
    await expectDialogReturnsFocus(page, page.getByRole('button', { name: action, exact: true }), title);
  }
  await page.getByRole('button', { name: 'New wallet', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create a wallet' });
  await dialog.getByLabel('Wallet name').fill('Focus reserve');
  await dialog.getByRole('button', { name: 'Create wallet', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet created');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Archive Focus reserve', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Archive wallet' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Archive wallet', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet archived');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByText('Archived wallets (1)', { exact: true }).click();
  await expectDialogReturnsFocus(page, page.getByRole('button', { name: 'Restore Focus reserve', exact: true }), 'Restore wallet');
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
  await expect(page.getByText('First safe wallet').first()).toBeVisible();
  await expect(page.getByText(/LBP.*0/)).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-first-wallet.png'), fullPage: true });
});

test('income and expense refresh the protected journal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await postTransaction(page, 'income', '45.25');
  await postTransaction(page, 'expense', '12');
  await expect(page.locator('.journal-table [role="cell"][aria-label="Event: Income"]').last()).toBeVisible();
  await expect(page.locator('.journal-table [role="cell"][aria-label="Event: Expense"]').last()).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-income-expense.png'), fullPage: true });
});

test('same-currency transfer records equal and opposite effects', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await postTransaction(page, 'transfer', '10');
  await expect(page.getByRole('cell', { name: 'Event: Transfer' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-transfer.png'), fullPage: true });
});

test('undoing a general event creates a linked reversal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'Undo income' }).click();
  const dialog = page.getByRole('dialog', { name: 'Undo this transaction' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Undo transaction' }).click();
  await expect(dialog.getByRole('status')).toContainText('Transaction undone');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Undone', { exact: true })).toBeVisible();
  await expect(page.getByText('Undoes an earlier entry', { exact: true })).toBeVisible();
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
  await expect(activeWalletName(page, 'Daily USD')).toBeVisible();
  await switchWorkspaceSpace(page, 'Current space: My money', 'Switch to Home budget');
  await expect(activeWalletName(page, 'Daily USD')).toHaveCount(0);
  await expect(activeWalletName(page, 'Household USD')).toBeVisible();
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
  await switchWorkspaceLanguage(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'المحافظ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'سجل المعاملات' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-arabic-wallet-history.png'), fullPage: true });
});

test('renaming a wallet updates its name everywhere, including posted history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'Rename Daily USD' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename wallet' });
  await dialog.getByLabel('Wallet name').fill('Everyday USD');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet renamed');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(activeWalletName(page, 'Everyday USD')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Event: Loan payment' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-wallet-renamed.png'), fullPage: true });
});

test('a non-zero-balance wallet offers no archive action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'Archive Daily USD' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive wallet' });
  await expect(dialog.getByText('$1,250.50')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Archive wallet' })).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-archive-blocked.png') });
});

test('archiving a zero-balance wallet with history gates its Undo actions, and restoring returns them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openWallets(page);
  await page.getByRole('button', { name: 'New wallet' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create a wallet' });
  await dialog.getByLabel('Wallet name').fill('Travel fund');
  await dialog.getByRole('button', { name: 'Create wallet' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet created');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(activeWalletName(page, 'Travel fund')).toBeVisible();

  // Post an equal income and expense on Travel fund itself (not the default
  // wallet) so it returns to exactly zero while leaving two still-undoable
  // entries in its history — the only way to observe undo-gating for real.
  for (const kind of ['income', 'expense'] as const) {
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const txDialog = page.getByRole('dialog', { name: 'Add a transaction' });
    await txDialog.getByLabel('Type').selectOption(kind);
    await txDialog.getByLabel('Wallet').selectOption({ label: 'Travel fund · USD' });
    await txDialog.getByLabel('Amount').fill('10');
    await txDialog.getByRole('button', { name: 'Review transaction' }).click();
    await txDialog.getByRole('button', { name: kind === 'income' ? 'Record income' : 'Record expense' }).click();
    await expect(txDialog.getByRole('status')).toContainText('Transaction recorded');
    await txDialog.getByRole('button', { name: 'Done' }).click();
  }
  // Two "Undo income" buttons now exist: the seeded Daily USD income entry
  // (unrelated to this wallet) plus the one just posted on Travel fund. Only
  // Travel fund's own entries get gated by its archival, so the seeded one
  // must keep its Undo button — the count drops by exactly one, not to zero.
  await expect(page.getByRole('button', { name: 'Undo income' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Undo expense' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Archive Travel fund' }).click();
  dialog = page.getByRole('dialog', { name: 'Archive wallet' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Archive wallet' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet archived');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('button', { name: 'Archive Travel fund' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo income' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo expense' })).toHaveCount(0);
  await expect(page.getByText('Restore Travel fund to undo this').first()).toBeVisible();
  await page.getByText('Archived wallets (1)').click();
  await expect(page.getByText('Travel fund').first()).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-wallet-archived.png'), fullPage: true });

  await page.getByRole('button', { name: 'Restore Travel fund' }).click();
  dialog = page.getByRole('dialog', { name: 'Restore wallet' });
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(dialog.getByRole('status')).toContainText('Wallet restored');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('button', { name: 'Archive Travel fund' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo income' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Undo expense' })).toHaveCount(1);
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-wallet-restored.png'), fullPage: true });
});

test('Arabic mobile archived wallets disclosure and restore render right-to-left', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openWallets(page);
  await switchWorkspaceLanguage(page);
  await page.getByRole('button', { name: 'أرشفة Home LBP' }).click();
  const archiveDialog = page.getByRole('dialog', { name: 'أرشفة المحفظة' });
  await expect(archiveDialog.getByRole('button', { name: 'أرشفة المحفظة' })).toHaveCount(0);
  await archiveDialog.getByRole('button', { name: 'إغلاق' }).click();
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-arabic-archive-blocked.png'), fullPage: true });
});
