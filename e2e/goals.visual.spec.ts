import { expect, test, type TestInfo } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { expectContainedControls } from './workspace-contract.js';
import { chooseWorkspaceDestination, switchWorkspaceLanguage } from './workspace-navigation.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/goals/${name}`
    : testInfo.outputPath(name);
}

const goalId = 'd0000000-0000-4000-8000-000000000001';
const milestoneId = 'd0000000-0000-4000-8000-000000000201';

// U13-01/U13-04: 100000 target, 90000 earmarked, 60000 cash-covered (a
// 30000 shortage before bills), 40000 already fulfilled from a linked
// purchase -- the exact plan-pack coverage/fulfillment scenario.
const coreGoal: Record<string, unknown> = {
  id: goalId, revisionId: '1', currency: 'USD', kind: 'purchase', state: 'active',
  nameEn: 'New laptop', nameAr: 'كمبيوتر محمول جديد', targetMinor: '100000',
  earmarkedMinor: '90000', coveredMinor: '60000', fulfilledMinor: '40000', shortageMinor: '30000',
  monthlyTargetMinor: '20000', monthlyNetContributionMinor: '15000',
  dueDate: null, horizon: 'open', needsReview: false,
  suggestedMonthlyMinor: null, forecastMonth: null, forecastState: 'insufficient_history',
  asOf: '2026-09-14T12:00:00Z',
};

const coreMilestones: Record<string, unknown>[] = [
  { id: milestoneId, kind: 'checklist', labelEn: 'Compare models', labelAr: 'قارن الطرازات', thresholdMinor: null, dueDate: null, ordinal: 0, currentState: 'incomplete' },
];

async function openPlan(page: import('@playwright/test').Page, options: Parameters<typeof installApplicationFixture>[1] = {}) {
  await installApplicationFixture(page, options);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Monthly plan' })).toBeVisible();
}

test('U13-01/U13-04 shows target, earmarked, cash-covered, fulfilled, shortage, and a checklist milestone distinctly', async ({ page }, testInfo) => {
  await openPlan(page, { seedGoals: [coreGoal], goalMilestones: coreMilestones });
  const usdSection = page.getByRole('region', { name: 'Goals USD' });
  await usdSection.getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('region', { name: 'Goal detail' });
  await expect(detail).toContainText('$1,000.00'); // target
  await expect(detail).toContainText('$900.00'); // earmarked
  await expect(detail).toContainText('$600.00'); // cash-covered
  await expect(detail).toContainText('$400.00'); // fulfilled
  await expect(detail).toContainText('$300.00'); // shortage before bills
  await expect(detail.locator('ol').getByText('Compare models')).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `goal-detail-${testInfo.project.name}.png`), fullPage: true });
});

test('an empty goal list shows New goal, not a crash', async ({ page }) => {
  await openPlan(page);
  const usdSection = page.getByRole('region', { name: 'Goals USD' });
  await expect(usdSection.getByText('No goals yet in this view.')).toBeVisible();
  await expect(usdSection.getByRole('button', { name: 'New goal' })).toBeVisible();
});

test('creating a goal shows it in the list afterward', async ({ page }, testInfo) => {
  await openPlan(page);
  const usdSection = page.getByRole('region', { name: 'Goals USD' });
  await usdSection.getByRole('button', { name: 'New goal' }).click();

  const form = page.getByRole('form', { name: 'Goal details' });
  await form.getByLabel('Name (English)').fill('Emergency fund');
  await form.getByLabel('Target amount').fill('6000');
  await expectContainedControls(page, form);
  await page.screenshot({ path: screenshotPath(testInfo, `goal-editor-${testInfo.project.name}.png`) });

  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(usdSection.getByText('Emergency fund')).toBeVisible();
});

test('the funding dialog reserves an amount against the viewed goal', async ({ page }) => {
  await openPlan(page, { seedGoals: [coreGoal], goalMilestones: coreMilestones });
  const usdSection = page.getByRole('region', { name: 'Goals USD' });
  await usdSection.getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('region', { name: 'Goal detail' });
  await detail.getByRole('button', { name: /Manage funding/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Manage funding' });
  await dialog.getByLabel('Amount').fill('100');
  await expectContainedControls(page, dialog);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
});

test('the milestone checklist marks a step complete from the detail view', async ({ page }) => {
  await openPlan(page, { seedGoals: [coreGoal], goalMilestones: coreMilestones });
  const usdSection = page.getByRole('region', { name: 'Goals USD' });
  await usdSection.getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('region', { name: 'Goal detail' });
  await detail.getByRole('button', { name: 'Mark complete' }).click();
  await expect(detail.getByRole('button', { name: 'Reopen' })).toBeVisible();
});

test('Arabic RTL mirrors the goals overview and detail', async ({ page }, testInfo) => {
  await openPlan(page, { seedGoals: [coreGoal], goalMilestones: coreMilestones });
  await switchWorkspaceLanguage(page);
  await chooseWorkspaceDestination(page, 'الخطة');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const arSection = page.getByRole('region', { name: 'الأهداف USD' });
  await expect(arSection.getByText('كمبيوتر محمول جديد')).toBeVisible();
  await arSection.getByRole('button', { name: 'عرض' }).click();
  const detail = page.getByRole('region', { name: 'تفاصيل الهدف' });
  await expect(detail.locator('ol').getByText('قارن الطرازات')).toBeVisible();
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `goals-ar-${testInfo.project.name}.png`), fullPage: true });
});
