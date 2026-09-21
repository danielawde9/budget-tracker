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

async function openPlan(page: import('@playwright/test').Page, options: Parameters<typeof installApplicationFixture>[1] = {}) {
  await installApplicationFixture(page, options);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Personal space' })).toBeVisible();
  await chooseWorkspaceDestination(page, 'Plan');
  await expect(page.getByRole('heading', { name: 'Monthly plan' })).toBeVisible();
  await openPlanSection(page, 'Upcoming bills');
}

test('U16-01/U16-02 shows expected/settled/remaining distinctly and a February month-end due date verbatim', async ({ page }, testInfo) => {
  await openPlan(page, { seedOccurrences: [rentOccurrence, internetOccurrence] });
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await expect(section.getByText('Internet')).toBeVisible();
  await expect(section.getByText('2026-02-28')).toBeVisible();
  await section.getByRole('button', { name: 'Review Rent' }).click();
  const detail = page.getByRole('region', { name: 'Occurrence detail' });
  await expect(detail).toContainText('$500.00'); // expected
  await expect(detail).toContainText('$200.00'); // settled
  await expect(detail).toContainText('$300.00'); // remaining
  await expectContainedControls(page);
  await page.screenshot({ path: screenshotPath(testInfo, `occurrence-detail-${testInfo.project.name}.png`), fullPage: true });
});

test('an empty occurrence list shows New schedule, not a crash', async ({ page }) => {
  await openPlan(page);
  const section = page.getByRole('region', { name: 'Upcoming bills' });
  await expect(section.getByText(/No occurrences in this view yet/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'New schedule' })).toBeVisible();
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
  await form.getByLabel('Name (English)').fill('Water');
  const startsOn = new Date().toISOString().slice(0, 10);
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
