import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { expectContainedControls } from './workspace-contract.js';
import { chooseWorkspaceDestination, openWorkspaceNavigation, switchWorkspaceLanguage } from './workspace-navigation.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/control-room/${name}`
    : testInfo.outputPath(name);
}

// Merged key set: satisfies both the plan client's category page parser and the
// insights actual-vs-budget parser (each only reads its own keys).
const seededBudgetRows: Record<string, unknown>[] = [
  {
    category_id: '22222222-2222-4222-8222-222222222222',
    category_key: '22222222-2222-4222-8222-222222222222',
    name_en: 'Groceries',
    name_ar: 'بقالة',
    category_name_en: 'Groceries',
    category_name_ar: 'بقالة',
    category_kind: 'expense',
    archived_at: null,
    currency: 'USD',
    target_minor: '30000',
    budget_minor: '30000',
    actual_spent_minor: '34500',
    actual_net_minor: '-34500',
    remaining_minor: '-4500',
    overspent_minor: '4500',
    target_revision_id: '7',
  },
  {
    category_id: '44444444-4444-4444-8444-444444444444',
    category_key: '44444444-4444-4444-8444-444444444444',
    name_en: 'Essentials',
    name_ar: 'الأساسيات',
    category_name_en: 'Essentials',
    category_name_ar: 'الأساسيات',
    category_kind: 'expense',
    archived_at: null,
    currency: 'USD',
    target_minor: '40000',
    budget_minor: '40000',
    actual_spent_minor: '18000',
    actual_net_minor: '-18000',
    remaining_minor: '22000',
    overspent_minor: '0',
    target_revision_id: '8',
  },
];

const seededPlanSummary: Record<string, unknown>[] = [
  {
    currency: 'USD',
    planned_income_minor: '250000',
    actual_income_minor: '250050',
    category_target_total_minor: '70000',
    category_actual_spent_minor: '52500',
    uncategorized_spent_minor: '5000',
    category_overspent_minor: '4500',
    actual_loan_repayment_minor: '20000',
    remaining_loan_reservation_minor: '30000',
    loan_commitment_minor: '50000',
    unallocated_minor: '130000',
    overallocated_minor: '0',
    income_plan_revision_id: '3',
  },
];

const seededActivityRows: Record<string, unknown>[] = [
  {
    event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    kind: 'income',
    effective_date: '2026-09-07',
    created_at: '2026-09-07T14:00:00Z',
    reversal_of: null,
    wallet_id: 'usd-wallet',
    wallet_name: 'Daily USD',
    currency: 'USD',
    amount_minor: '25050',
    has_more: false,
  },
  {
    event_id: 'maya-payment',
    kind: 'loan_receive_repayment',
    effective_date: '2026-09-05',
    created_at: '2026-09-05T12:00:00Z',
    reversal_of: null,
    wallet_id: 'usd-wallet',
    wallet_name: 'Daily USD',
    currency: 'USD',
    amount_minor: '25000',
    has_more: false,
  },
];

async function openSeededHome(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApplicationFixture(page, {
    budgetRows: seededBudgetRows,
    planSummary: seededPlanSummary,
    activityRows: seededActivityRows,
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
}

test('Home shows budgets, recent activity, and loans within the viewport', async ({ page }, testInfo) => {
  await openSeededHome(page);
  const budgets = page.getByRole('region', { name: 'Budget vs actual' });
  await expect(budgets.getByText('Groceries')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent activity' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Loans' })).toContainText('Maya');
  await expect(page.getByText('No budget targets this month.')).toHaveCount(0);
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `home-${testInfo.project.name}.png`), fullPage: true });
});

test('Journal feed and entry detail sheet stay contained', async ({ page }, testInfo) => {
  await openSeededHome(page);
  await chooseWorkspaceDestination(page, 'Journal');
  await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `journal-${testInfo.project.name}.png`), fullPage: true });

  await page.locator('.cr-journal-row--button').first().click();
  const sheet = page.getByRole('dialog', { name: 'Archived travel' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Daily USD');
  await expectContainedControls(page, sheet);
  await page.screenshot({ path: screenshotPath(testInfo, `journal-entry-${testInfo.project.name}.png`) });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('Record sheet walks type, amount, and confirm steps', async ({ page }, testInfo) => {
  await openSeededHome(page);
  await page.getByRole('button', { name: 'Record' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Record', exact: true });
  await expect(sheet).toBeVisible();
  await expectContainedControls(page, sheet);
  await page.screenshot({ path: screenshotPath(testInfo, `record-type-${testInfo.project.name}.png`) });

  await sheet.getByRole('button', { name: 'Expense' }).click();
  for (const key of ['4', '2', '.', '5']) await sheet.getByRole('button', { name: key, exact: true }).click();
  await expect(page.getByRole('status', { name: 'Amount' })).toHaveText('42.5');
  await page.screenshot({ path: screenshotPath(testInfo, `record-amount-${testInfo.project.name}.png`) });
  await sheet.getByRole('button', { name: 'Continue' }).click();

  await sheet.getByRole('button', { name: /Daily USD/ }).click();
  await sheet.getByRole('button', { name: 'Expand Essentials' }).click();
  await sheet.getByRole('button', { name: 'Groceries' }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();

  await expect(sheet).toContainText('Expense · $42.50 · Daily USD · Groceries');
  await expectContainedControls(page, sheet);
  await page.screenshot({ path: screenshotPath(testInfo, `record-confirm-${testInfo.project.name}.png`) });
  await page.mouse.click(10, 10);
  await expect(sheet).toHaveCount(0);
});

test('Plan screen flags the over-budget category', async ({ page }, testInfo) => {
  await openSeededHome(page);
  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Monthly plan' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Planned income USD' })).toContainText('$2,500.00');
  const targets = page.getByRole('region', { name: 'Category targets' });
  await expect(targets).toContainText('Groceries');
  const groceries = targets.locator('li').filter({ hasText: 'Groceries' });
  await expect(groceries.locator('.cr-progress--over')).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `plan-${testInfo.project.name}.png`), fullPage: true });
});

test('Manage menu lists sections, language, and account', async ({ page }, testInfo) => {
  await openSeededHome(page);
  await chooseWorkspaceDestination(page, 'Manage');
  await expect(page.getByRole('heading', { name: 'Manage' })).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Manage sections' });
  await expect(menu.getByRole('button', { name: 'Wallets' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Categories' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Loans' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Household' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Language' })).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `manage-${testInfo.project.name}.png`), fullPage: true });
});

test('wallet load failure keeps workspace navigation available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApplicationFixture(page, { failWallets: true });
  await page.goto('/');
  await chooseWorkspaceDestination(page, 'Wallets');
  await expect(page.getByRole('alert')).toContainText('Wallets are unavailable');
  await chooseWorkspaceDestination(page, 'Journal');
  await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
});

for (const locale of ['en', 'ar'] as const) {
  test(`workspace navigation labels keep readable contrast ${locale}`, async ({ page }) => {
    await openSeededHome(page);
    if (locale === 'ar') await switchWorkspaceLanguage(page);
    const navigation = await openWorkspaceNavigation(page);
    const ratios = await navigation.locator('.cr-tab').evaluateAll((tabs) => tabs.map((tab) => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color: string) => {
        const [red, green, blue] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        return channel(red!) * 0.2126 + channel(green!) * 0.7152 + channel(blue!) * 0.0722;
      };
      const foreground = luminance(getComputedStyle(tab).color);
      let surface: Element | null = tab;
      while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
      const background = luminance(getComputedStyle(surface!).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    }));
    expect(ratios.length).toBeGreaterThan(0);
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

test('Arabic RTL mirrors Home and the Record type grid', async ({ page }, testInfo) => {
  await openSeededHome(page);
  await switchWorkspaceLanguage(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'مساحة شخصية' })).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `home-ar-${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole('button', { name: 'سجل' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'تسجيل' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'مصروف' })).toBeVisible();
  await expectContainedControls(page, sheet);
  await page.screenshot({ path: screenshotPath(testInfo, `record-type-ar-${testInfo.project.name}.png`) });
  await page.mouse.click(10, 10);
  await expect(sheet).toHaveCount(0);
});
