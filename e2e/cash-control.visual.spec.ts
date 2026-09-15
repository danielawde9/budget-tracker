import { expect, test, type TestInfo } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { expectContainedControls } from './workspace-contract.js';
import { chooseWorkspaceDestination, switchWorkspaceLanguage } from './workspace-navigation.js';
import { formatMinorAmount } from '../src/features/wallets/money.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/cash-control/${name}`
    : testInfo.outputPath(name);
}

// U19-01 (cash 100000 minus commitments 110000 -> shortfall 10000) and
// U19-02 (a goal of 30000 funding a 50000 bill reserves 50000 once, not
// 80000: the one group's own commitmentMinor is already the deduplicated
// Q_g=20000, and 30000(R)+20000(Q_g)+60000(debt)=110000 total, never
// 30000+50000=80000) in one fixture: cash=100000, goalClaims(R)=30000,
// debtCommitments=60000, and the sole group's budgetRemaining=0/
// unpaidBills=50000/goalOverlap=30000/commitment=20000.
const readyCashSummary: Record<string, unknown> = {
  currency: 'USD', asOf: '2026-09-15', state: 'ready', needsReview: false, snapshotId: '42',
  cashMinor: '100000', goalClaimsMinor: '30000',
  expenseCommitmentsMinor: '20000', debtCommitmentsMinor: '60000', goalTopupsMinor: '0', futureHeadroomMinor: '0',
  availableMinor: '-10000', deficitMinor: '10000', spendableMinor: '0', dailyExtraGuideMinor: null,
  daysRemaining: 3, receivedIncomeMinor: '75000', ordinarySpendingMinor: '30000', incomeMinusSpendingMinor: '45000',
  uncategorizedMinor: '0', unmaterializedCount: 0,
  groups: [{
    id: 'a0000000-0000-4000-8000-000000000001', nameEn: 'Essentials', nameAr: 'الأساسيات',
    budgetRemainingMinor: '0', unpaidBillsMinor: '50000', goalOverlapMinor: '30000', commitmentMinor: '20000',
  }],
};

// U19-05: a partial month (3 remaining days, inclusive) with a positive
// available amount so the daily extra guide actually renders (1001/3->333,
// retaining the 2-minor-unit remainder server-side, per 17-available-cash-
// db.md's own acceptance example -- rendered verbatim, never recomputed).
const partialMonthCashSummary: Record<string, unknown> = {
  ...readyCashSummary,
  availableMinor: '1001', deficitMinor: '0', spendableMinor: '1001', dailyExtraGuideMinor: '333', daysRemaining: 3,
};

const readyCashOutlook: Record<string, unknown> = {
  days: [
    { date: '2026-09-15', openingCashMinor: '100000', expectedIncomeMinor: '0', expectedOutflowMinor: '20000', closingCashMinor: '80000' },
    { date: '2026-09-16', openingCashMinor: '80000', expectedIncomeMinor: '0', expectedOutflowMinor: '90000', closingCashMinor: '-10000' },
  ],
  firstNegativeDate: '2026-09-16', state: 'ready', overdueCount: 1, overdueMinor: '5000',
};

async function openPlan(page: import('@playwright/test').Page, options: Parameters<typeof installApplicationFixture>[1] = {}) {
  await installApplicationFixture(page, options);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Monthly plan' })).toBeVisible();
}

test('U19-01/U19-02: Home shows a compact signed shortfall, Plan shows the full breakdown with the already-deduplicated group commitment', async ({ page }, testInfo) => {
  await installApplicationFixture(page, { seedAvailableCashSummary: readyCashSummary, seedCashOutlook: readyCashOutlook });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();

  const homeCard = page.getByRole('region', { name: 'Available after commitments', exact: true });
  await expect(homeCard).toContainText('-$100.00'); // signed, not clamped
  await expect(homeCard).toContainText('Shortfall');
  await page.screenshot({ path: screenshotPath(testInfo, `home-compact-${testInfo.project.name}.png`), fullPage: true });

  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Monthly plan' })).toBeVisible();
  const usdSection = page.getByRole('region', { name: 'Available after commitments USD' });
  await usdSection.scrollIntoViewIfNeeded();
  await expect(usdSection).toContainText('-$100.00');
  await expect(usdSection).toContainText('$100.00'); // shortfall figure
  await expect(usdSection).toContainText('$0.00'); // spendable, floored at zero

  const groupRow = usdSection.getByText('Essentials').locator('xpath=ancestor::tr[1]');
  await expect(groupRow).toContainText('$500.00'); // unpaid bills
  await expect(groupRow).toContainText('$300.00'); // covered by goal
  await expect(groupRow).toContainText('$200.00'); // net reserved -- 20000, never 50000+30000=80000
  await expect(groupRow).not.toContainText('$800.00'); // never the naively-summed 50000+30000

  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `plan-detail-${testInfo.project.name}.png`), fullPage: true });
});

test('an unplanned currency shows a no-plan message on Home and Plan, not a crash', async ({ page }) => {
  await installApplicationFixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Available after commitments', exact: true })).toContainText('No published plan yet');

  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Monthly plan' })).toBeVisible();
  const usdSection = page.getByRole('region', { name: 'Available after commitments USD' });
  await expect(usdSection).toContainText('No published plan snapshot yet');
});

test('U19-05: the daily extra guide renders the server-computed inclusive remaining days verbatim', async ({ page }) => {
  await openPlan(page, { seedAvailableCashSummary: partialMonthCashSummary });
  const usdSection = page.getByRole('region', { name: 'Available after commitments USD' });
  await expect(usdSection).toContainText('Extra unassigned cash per day');
  await expect(usdSection).toContainText('$3.33');
  await expect(usdSection).toContainText('3 remaining day');
});

test('the outlook scenario switch changes the visible assumption text, and the negative day is flagged', async ({ page }) => {
  await openPlan(page, { seedAvailableCashSummary: readyCashSummary, seedCashOutlook: readyCashOutlook });
  const usdSection = page.getByRole('region', { name: 'Available after commitments USD' });
  await expect(usdSection).toContainText('First projected shortfall');
  await expect(usdSection).toContainText('Overdue');
  await expect(usdSection.getByText('First shortfall')).toBeVisible();

  await expect(usdSection).toContainText('Projects only unpaid scheduled income');
  await usdSection.getByRole('tab', { name: 'Conservative (no future income)' }).click();
  await expect(usdSection).toContainText('Assumes no further income arrives');
});

test('a group’s Details drilldown expands its plain-language reservation explanation', async ({ page }) => {
  await openPlan(page, { seedAvailableCashSummary: readyCashSummary });
  const usdSection = page.getByRole('region', { name: 'Available after commitments USD' });
  const detailsButton = usdSection.getByRole('button', { name: 'Details Essentials' });
  await expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
  await detailsButton.click();
  await expect(usdSection).toContainText('still reserved against a remaining budget');
  await expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
});

test('the compact Home card recovers from a load failure via its own distinctly-labelled retry', async ({ page }) => {
  await installApplicationFixture(page, { failAvailableCashSummaryOnce: true, seedAvailableCashSummary: readyCashSummary });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
  await expect(page.getByText('Available after commitments could not be loaded.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry available cash' }).first().click();
  await expect(page.getByText('Available after commitments could not be loaded.')).toHaveCount(0);
});

test('Arabic RTL mirrors the compact and full available-after-commitments views', async ({ page }, testInfo) => {
  await installApplicationFixture(page, { seedAvailableCashSummary: readyCashSummary, seedCashOutlook: readyCashOutlook });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
  await switchWorkspaceLanguage(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const arHomeCard = page.getByRole('region', { name: 'المتاح بعد الالتزامات', exact: true });
  await expect(arHomeCard).toContainText(formatMinorAmount('-10000', 'USD', 'ar'));

  await chooseWorkspaceDestination(page, 'الخطة');
  const arSection = page.getByRole('region', { name: 'المتاح بعد الالتزامات USD' });
  await arSection.scrollIntoViewIfNeeded();
  await expect(arSection).toContainText(formatMinorAmount('-10000', 'USD', 'ar'));
  await expect(arSection.getByText('الأساسيات')).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `cash-control-ar-${testInfo.project.name}.png`), fullPage: true });
});
