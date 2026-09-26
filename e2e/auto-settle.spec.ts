import { expect, test } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { chooseWorkspaceDestination, openPlanSection } from './workspace-navigation.js';

const INTERNET_OCCURRENCE = {
  id: 'd0000000-0000-4000-8000-000000000099',
  scheduleId: 'd0000000-0000-4000-8000-000000000098',
  sourceRevisionId: '1',
  currentEventId: null,
  currency: 'USD',
  kind: 'expense',
  nameEn: 'Internet',
  nameAr: null,
  dueDate: '2026-09-30',
  expectedMinor: '6000',
  settledMinor: '0',
  remainingMinor: '6000',
  state: 'pending',
  overdue: false,
  categoryId: '44444444-4444-4444-8444-444444444444',
  loanId: null,
  fundingGoalId: null,
  preferredWalletId: null,
  fundingShortfallMinor: null,
  asOf: '2026-09-20',
};

async function recordSixtyDollarEssentialsExpense(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Record' }).first().click();
  await page.getByRole('button', { name: 'Expense' }).click();
  for (const key of ['6', '0']) await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Daily USD' }).click();
  await page.getByRole('button', { name: 'Essentials', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
}

test('recording an expense that exactly matches a bill settles it automatically', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApplicationFixture(page, { seedOccurrences: [INTERNET_OCCURRENCE] });
  await page.goto('/');
  // Scoped to the Upcoming bills region itself: the settle notice below
  // renders outside it (above whichever destination is active), and it also
  // contains the bill's name -- a page-wide getByText('Internet') would
  // match both and the assertions below would not tell them apart.
  const upcomingBills = page.getByRole('region', { name: 'Upcoming bills' });
  await chooseWorkspaceDestination(page, 'Plan');
  await openPlanSection(page, 'Upcoming bills');
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(upcomingBills.getByText('Internet')).toBeVisible();

  await chooseWorkspaceDestination(page, 'Home');
  await recordSixtyDollarEssentialsExpense(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.locator('.cr-header-text').getByText('Personal space', { exact: true })).toBeVisible();

  const settleNotice = page.getByRole('status').filter({ hasText: 'Internet' });
  await expect(settleNotice).toBeVisible();
  await expect(settleNotice).toContainText('as paid');

  await chooseWorkspaceDestination(page, 'Plan');
  await openPlanSection(page, 'Upcoming bills');
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(upcomingBills.getByText('Internet')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Paid', exact: true }).click();
  await expect(upcomingBills.getByText('Internet')).toBeVisible();
});

test('a non-matching expense leaves the bill pending', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApplicationFixture(page, { seedOccurrences: [INTERNET_OCCURRENCE] });
  await page.goto('/');
  const upcomingBills = page.getByRole('region', { name: 'Upcoming bills' });
  await chooseWorkspaceDestination(page, 'Plan');
  await openPlanSection(page, 'Upcoming bills');
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(upcomingBills.getByText('Internet')).toBeVisible();

  await chooseWorkspaceDestination(page, 'Home');
  // Record $61 -- close but not the expected $60.
  await page.getByRole('button', { name: 'Record' }).first().click();
  await page.getByRole('button', { name: 'Expense' }).click();
  for (const key of ['6', '1']) await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Daily USD' }).click();
  await page.getByRole('button', { name: 'Essentials', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.locator('.cr-header-text').getByText('Personal space', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Internet' })).toHaveCount(0);

  await chooseWorkspaceDestination(page, 'Plan');
  await openPlanSection(page, 'Upcoming bills');
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(upcomingBills.getByText('Internet')).toBeVisible();
  await page.getByRole('tab', { name: 'Paid', exact: true }).click();
  await expect(upcomingBills.getByText('Internet')).toHaveCount(0);
});
