import { expect, test, type TestInfo } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { expectContainedControls } from './workspace-contract.js';
import { chooseWorkspaceDestination, openPlanSection, switchWorkspaceLanguage } from './workspace-navigation.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/allocation/${name}`
    : testInfo.outputPath(name);
}

const essentialsGroupId = 'e0000000-0000-4000-8000-000000000001';
const lifestyleGroupId = 'e0000000-0000-4000-8000-000000000002';
const futureGroupId = 'e0000000-0000-4000-8000-000000000003';

// The exact plan-pack Task 3 fixture: 200000 planned / 180000 received,
// Essentials 112000 target/118000 actual, Lifestyle 48000/43000, Future
// 40000 target with 15000 paid -- expense 161000, incomeAfterSpending 19000.
const coreAllocationMonth: Record<string, unknown> = {
  snapshotId: '12', templateRevisionId: '9', incomeRevisionId: '30001', hasPlan: true,
  plannedIncomeMinor: '200000', actualIncomeMinor: '180000', expenseMinor: '161000',
  incomeAfterSpendingMinor: '19000', ownDebtPaidMinor: '15000', remainingDebtMinor: '0',
  leftToAllocateMinor: '0', childPlanChanged: false, asOf: '2026-09-14T12:00:00Z',
  groups: [
    { groupId: essentialsGroupId, rowKind: 'spending', nameEn: 'Essentials', nameAr: 'الأساسيات', order: 0, targetMinor: '112000', actualMinor: '118000', varianceMinor: '-6000', basisPoints: 5600, actualShareOfIncomeBps: '6555', hasPlan: true },
    { groupId: lifestyleGroupId, rowKind: 'spending', nameEn: 'Lifestyle', nameAr: 'نمط الحياة', order: 1, targetMinor: '48000', actualMinor: '43000', varianceMinor: '5000', basisPoints: 2400, actualShareOfIncomeBps: '2388', hasPlan: true },
    { groupId: futureGroupId, rowKind: 'future', nameEn: 'Future', nameAr: 'مستقبلي', order: 2, targetMinor: '40000', actualMinor: '15000', varianceMinor: '25000', basisPoints: 2000, actualShareOfIncomeBps: '833', hasPlan: true },
    { groupId: null, rowKind: 'unmapped', nameEn: null, nameAr: null, order: null, targetMinor: '0', actualMinor: '0', varianceMinor: '0', basisPoints: null, actualShareOfIncomeBps: '0', hasPlan: false },
    { groupId: null, rowKind: 'uncategorized', nameEn: null, nameAr: null, order: null, targetMinor: null, actualMinor: '0', varianceMinor: null, basisPoints: null, actualShareOfIncomeBps: '0', hasPlan: false },
  ],
};

async function openPlan(page: import('@playwright/test').Page, options: Parameters<typeof installApplicationFixture>[1] = {}) {
  await installApplicationFixture(page, options);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Monthly plan' })).toBeVisible();
  await openPlanSection(page, 'Allocation');
}

test('U08-01 shows 200000 planned, 180000 received, 161000 spent, and 19000 after spending', async ({ page }, testInfo) => {
  await openPlan(page, { allocationMonth: coreAllocationMonth });
  const usdSection = page.getByRole('region', { name: 'Allocation USD' });
  await expect(usdSection).toContainText('$2,000.00');
  await expect(usdSection).toContainText('$1,800.00');
  await expect(usdSection).toContainText('$1,610.00');
  await expect(usdSection).toContainText('$190.00');
  await expect(usdSection.getByText('Essentials')).toBeVisible();
  await expect(usdSection.getByText('Lifestyle')).toBeVisible();
  await expect(usdSection.getByText('(paid/allocated)')).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `plan-allocation-${testInfo.project.name}.png`), fullPage: true });
});

test('a month with no allocation plan yet shows Set up, not a crash', async ({ page }) => {
  await openPlan(page);
  const usdSection = page.getByRole('region', { name: 'Allocation USD' });
  await expect(usdSection.getByRole('button', { name: 'Set up' })).toBeVisible();
  await expect(usdSection.getByText('No allocation plan for this month yet.')).toBeVisible();
});

test('setup confirms a manual-mode plan and the overview reflects it afterward', async ({ page }, testInfo) => {
  await openPlan(page);
  const usdSection = page.getByRole('region', { name: 'Allocation USD' });
  await usdSection.getByRole('button', { name: 'Set up' }).click();

  const form = page.getByRole('form', { name: 'Allocation setup' });
  await expect(form.getByRole('radio', { name: 'Manual (targets only)' })).toBeChecked();
  await form.getByLabel('Planned income').fill('1000');
  await expectContainedControls(page, form);
  await page.screenshot({ path: screenshotPath(testInfo, `allocation-setup-manual-${testInfo.project.name}.png`) });

  await form.getByRole('button', { name: 'Confirm' }).click();
  await expect(form).toHaveCount(0);
  await expect(usdSection.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(usdSection).toContainText('$1,000.00');
});

test('setup confirms a percentage-mode plan with a mapped category', async ({ page }) => {
  await openPlan(page);
  const usdSection = page.getByRole('region', { name: 'Allocation USD' });
  await usdSection.getByRole('button', { name: 'Set up' }).click();
  const form = page.getByRole('form', { name: 'Allocation setup' });

  await form.getByRole('radio', { name: 'Percentage groups' }).click();
  await form.getByLabel('Planned income').fill('1000');
  await form.getByLabel('Group name').fill('Essentials');
  const percentInput = form.getByLabel('Percent', { exact: true });
  await percentInput.fill('100');
  await expect(form.getByText('Total: 100%')).toBeVisible();

  await form.getByRole('button', { name: 'Confirm' }).click();
  await expect(form).toHaveCount(0);
  await expect(usdSection).toContainText('Essentials');
  await expect(usdSection).toContainText('$1,000.00');
});

test('drilldown opens a dialog with the group\'s category rows', async ({ page }) => {
  await openPlan(page, {
    allocationMonth: coreAllocationMonth,
    allocationCategoryPage: {
      rows: [{ rootId: '10000000-0000-4000-8000-000000000001', nameEn: 'Groceries', nameAr: 'بقالة', targetMinor: '50000', actualMinor: '45000', varianceMinor: '5000', hasPlan: true, groupId: essentialsGroupId }],
      nextRootId: null, hasMore: false,
    },
  });
  const usdSection = page.getByRole('region', { name: 'Allocation USD' });
  await usdSection.getByRole('button', { name: 'View Essentials categories' }).click();
  const dialog = page.getByRole('dialog', { name: 'Category detail' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Groceries');
  await expectContainedControls(page, dialog);
});

test('Arabic RTL mirrors the allocation overview', async ({ page }, testInfo) => {
  await openPlan(page, { allocationMonth: coreAllocationMonth });
  await switchWorkspaceLanguage(page);
  await chooseWorkspaceDestination(page, 'الخطة');
  await openPlanSection(page, 'التخصيص');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const usdSection = page.getByRole('region', { name: 'التخصيص USD' });
  await expect(usdSection.getByText('الأساسيات').first()).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `allocation-ar-${testInfo.project.name}.png`), fullPage: true });
});
