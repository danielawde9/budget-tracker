import { expect, test } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { chooseWorkspaceDestination, openPlanSection } from './workspace-navigation.js';

// The guided "Buy it" flow on an active purchase goal: one action records the
// categorized expense, links it to the goal (by request id, never a pasted
// UUID) and closes the goal.
const coreGoal: Record<string, unknown> = {
  id: 'd0000000-0000-4000-8000-000000000001', revisionId: '1', currency: 'USD', kind: 'purchase', state: 'active',
  nameEn: 'New laptop', nameAr: 'كمبيوتر محمول جديد', targetMinor: '100000',
  earmarkedMinor: '90000', coveredMinor: '60000', fulfilledMinor: '30000', shortageMinor: '30000',
  monthlyTargetMinor: null, monthlyNetContributionMinor: '0',
  dueDate: null, horizon: 'open', needsReview: false,
  suggestedMonthlyMinor: null, forecastMonth: null, forecastState: 'insufficient_history',
  asOf: '2026-09-14T12:00:00Z',
};

test('buy it records the expense, links the purchase and closes the goal in one step', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page, { seedGoals: [coreGoal] });
  await page.goto('/');
  await chooseWorkspaceDestination(page, 'Plan');
  await openPlanSection(page, 'Goals');

  const usdSection = page.getByRole('region', { name: 'Goals USD' });
  await usdSection.getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('region', { name: 'Goal detail' });
  await detail.getByRole('button', { name: 'Buy it' }).click();
  const dialog = page.getByRole('dialog', { name: 'Buy it' });
  await dialog.getByLabel('Amount').fill('300');
  await dialog.getByRole('button', { name: 'Buy it' }).click();

  const steps = dialog.getByRole('status');
  await expect(steps).toContainText('Expense recorded');
  await expect(steps).toContainText('Purchase linked');
  await expect(steps).toContainText('Goal closed');

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});
