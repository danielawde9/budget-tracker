import { expect, test, type TestInfo } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { expectContainedControls } from './workspace-contract.js';
import { chooseWorkspaceDestination, openPlanSection, switchWorkspaceLanguage } from './workspace-navigation.js';
import { formatMinorAmount } from '../src/features/wallets/money.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/recurring/${name}`
    : testInfo.outputPath(name);
}

const rentId = 'e0000000-0000-4000-8000-000000000001';
const internetId = 'e0000000-0000-4000-8000-000000000002';
const rentScheduleId = 'e0000000-0000-4000-8000-000000000101';

// U16-01: expected 50000, settled 20000 -> 30000 remaining, shown as three
// distinct figures.
const rentOccurrence: Record<string, unknown> = {
  id: rentId, scheduleId: rentScheduleId, sourceRevisionId: '1', currentEventId: '3',
  currency: 'USD', kind: 'expense', nameEn: 'Rent', nameAr: 'الإيجار', dueDate: '2026-09-30',
  expectedMinor: '50000', settledMinor: '20000', remainingMinor: '30000', state: 'partial', overdue: false,
  categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null, fundingShortfallMinor: null,
  asOf: '2026-09-14',
};

// U16-02: a January-31 monthly schedule's February occurrence -- the DB
// already clamped this to the real month end (2026-02-28, not an overflowed
// March date); this UI must render it verbatim.
const internetOccurrence: Record<string, unknown> = {
  id: internetId, scheduleId: 'e0000000-0000-4000-8000-000000000102', sourceRevisionId: '1', currentEventId: null,
  currency: 'USD', kind: 'expense', nameEn: 'Internet', nameAr: null, dueDate: '2026-02-28',
  expectedMinor: '4000', settledMinor: '0', remainingMinor: '4000', state: 'pending', overdue: false,
  categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null, fundingShortfallMinor: null,
  asOf: '2026-02-14',
};

async function openPlan(page: import('@playwright/test').Page, options: Parameters<typeof installApplicationFixture>[1] = {}, today = '2026-09-14') {
  await installApplicationFixture(page, options);
  await page.route('**/rest/v1/rpc/space_clock', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ timezone: 'UTC', today, currentMonth: `${today.slice(0, 7)}-01` }),
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
  await openPlanSection(page, 'Upcoming bills');
}

test('U16-01 shows expected, settled and remaining distinctly for the viewed month', async ({ page }, testInfo) => {
  await openPlan(page, { seedOccurrences: [rentOccurrence, internetOccurrence] });
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await expect(section.getByText('Internet')).toHaveCount(0);
  await expect(section.getByText('2026-02-28')).toHaveCount(0);
  await section.getByRole('button', { name: 'Review Rent' }).click();
  const detail = page.getByRole('region', { name: 'Occurrence detail' });
  await expect(detail).toContainText('$500.00'); // expected
  await expect(detail).toContainText('$200.00'); // settled
  await expect(detail).toContainText('$300.00'); // remaining
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `occurrence-detail-${testInfo.project.name}.png`), fullPage: true });
});

test('U16-02 shows a February month-end date when viewing February', async ({ page }) => {
  await openPlan(page, { seedOccurrences: [internetOccurrence, rentOccurrence] }, '2026-02-14');
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await expect(section.getByText('Internet')).toBeVisible();
  await expect(section.getByRole('cell', { name: /2026-02-28/ })).toBeVisible();
  await expect(section.getByText('Rent', { exact: true })).toHaveCount(0);
});

test('an empty occurrence list shows New schedule, not a crash', async ({ page }) => {
  await openPlan(page);
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await expect(section.getByText(/No occurrences in this view yet/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'New schedule' })).toBeVisible();
});

// D1: an overdue bill still reduces Available even though it's due before the
// window `useRecurring` otherwise loads from -- it must not disappear from
// the list, and the "Overdue" filter tab must be able to match it.
const overdueOccurrence: Record<string, unknown> = {
  id: 'e0000000-0000-4000-8000-000000000003', scheduleId: 'e0000000-0000-4000-8000-000000000103', sourceRevisionId: '1', currentEventId: null,
  currency: 'USD', kind: 'expense', nameEn: 'Water', nameAr: null, dueDate: '2026-09-10',
  expectedMinor: '3000', settledMinor: '0', remainingMinor: '3000', state: 'pending', overdue: true,
  categoryId: null, loanId: null, fundingGoalId: null, preferredWalletId: null, fundingShortfallMinor: null,
  asOf: '2026-09-14',
};

test('D1: an overdue bill shows up under the Overdue filter', async ({ page }) => {
  await openPlan(page, { seedOccurrences: [overdueOccurrence] });
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await section.getByRole('tab', { name: 'Overdue' }).click();
  await expect(section.getByText('Water')).toBeVisible();
});

// Final review I3/M1: once paid, an overdue bill is in neither the overdue
// list nor the window (the fixture drops it from both routes, as the server
// does), so the detail must end on its success confirmation, not on "no
// longer in the visible range", and the bill must leave Overdue.
test('paying an overdue bill from its detail screen confirms it, and it leaves Overdue', async ({ page }) => {
  await openPlan(page, { seedOccurrences: [overdueOccurrence] });
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await section.getByRole('tab', { name: 'Overdue' }).click();
  await section.getByRole('button', { name: 'Review Water' }).click();
  const detail = page.getByRole('region', { name: 'Occurrence detail' });
  await detail.getByRole('button', { name: 'Review payment' }).click();

  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  await dialog.getByLabel('Actual amount').fill('30');
  await dialog.getByLabel('Paying wallet').selectOption({ label: 'Daily USD · USD' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('status')).toContainText('The payment has been recorded against this occurrence.');
  await expect(page.getByText('This occurrence is no longer in the visible range.')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(detail.getByRole('status')).toContainText('Payment recorded. This bill is paid and has left the list.');
  await detail.getByRole('button', { name: 'Back to upcoming bills' }).click();
  await section.getByRole('tab', { name: 'Overdue' }).click();
  await expect(section.getByText('Water')).toHaveCount(0);
});

test('U16-03: creating a schedule never posts an occurrence by itself -- only the explicit Refresh occurrences click does', async ({ page }, testInfo) => {
  await openPlan(page);
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await section.getByRole('button', { name: 'New schedule' }).click();

  const form = page.getByRole('form', { name: 'Schedule details' });
  // Step 1 (Type) defaults are what this schedule needs: expense, USD, active.
  await form.getByRole('button', { name: 'Next' }).click();
  // Step 2 (Amount).
  await form.getByLabel('Expected amount').fill('120');
  await form.getByRole('button', { name: 'Next' }).click();
  // Step 3 (Details).
  await form.getByLabel('Name', { exact: true }).fill('Water');
  const startsOn = '2026-09-14';
  await form.getByLabel('Starts on').fill(startsOn);
  await expectContainedControls(page, form);
  await page.screenshot({ path: screenshotPath(testInfo, `schedule-editor-${testInfo.project.name}.png`) });
  await form.getByRole('button', { name: 'Next' }).click();
  // Step 4 (References): every reference stays 'None'.
  await form.getByRole('button', { name: 'Next' }).click();
  // Step 5 (Review).
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Done' }).click();

  // Rendering/opening the page (and even the save itself) never posted an
  // occurrence -- the list is still empty until the explicit refresh.
  await expect(section.getByText(/No occurrences in this view yet/)).toBeVisible();
  await section.getByRole('button', { name: 'Refresh occurrences' }).click();
  await expect(section.getByText('Water')).toBeVisible();
  await expect(section.getByText(/No occurrences in this view yet/)).toHaveCount(0);
});

test('the payment dialog records a payment against the reviewed occurrence', async ({ page }) => {
  await openPlan(page, { seedOccurrences: [rentOccurrence] });
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await section.getByRole('button', { name: 'Review Rent' }).click();
  const detail = page.getByRole('region', { name: 'Occurrence detail' });
  await detail.getByRole('button', { name: 'Review payment' }).click();

  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  await dialog.getByLabel('Actual amount').fill('300');
  await dialog.getByLabel('Paying wallet').selectOption({ label: 'Daily USD · USD' });
  await expectContainedControls(page, dialog);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
});

test('skip and reopen an occurrence from its detail view', async ({ page }) => {
  const pendingOccurrence = { ...rentOccurrence, settledMinor: '0', remainingMinor: '50000', state: 'pending' };
  await openPlan(page, { seedOccurrences: [pendingOccurrence] });
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await section.getByRole('button', { name: 'Review Rent' }).click();
  const detail = page.getByRole('region', { name: 'Occurrence detail' });
  await detail.getByRole('button', { name: 'Skip' }).click();
  await expect(detail.getByText('Skipped')).toBeVisible();
  await detail.getByRole('button', { name: 'Reopen' }).click();
  await expect(detail.getByText('Upcoming', { exact: true })).toBeVisible();
});

test('Arabic RTL mirrors the upcoming bills overview and detail', async ({ page }, testInfo) => {
  await openPlan(page, { seedOccurrences: [rentOccurrence] });
  await switchWorkspaceLanguage(page);
  await chooseWorkspaceDestination(page, 'الخطة');
  await openPlanSection(page, 'الفواتير القادمة');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const arSection = page.getByRole('region', { name: 'الفواتير القادمة' });
  await expect(arSection.getByText('الإيجار')).toBeVisible();
  await arSection.getByRole('button', { name: /مراجعة/ }).click();
  const detail = page.getByRole('region', { name: 'تفاصيل الدفعة المستحقة' });
  await expect(detail).toContainText(formatMinorAmount('50000', 'USD', 'ar'));
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `recurring-ar-${testInfo.project.name}.png`), fullPage: true });
});
