import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import {
  householdFixtureIds,
  installHouseholdApiFixture,
  type HouseholdFixtureOptions,
} from './fixtures/household.js';

const TOKEN = 'A'.repeat(43);

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/household-ui/${name}`
    : testInfo.outputPath(name);
}

async function openHousehold(page: Page, options: HouseholdFixtureOptions = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installHouseholdApiFixture(page, options);
  await page.goto('/');
  await page.getByRole('button', { name: 'Household' }).click();
  if (!options.failHouseholdOnce) {
    await expect(page.getByRole('heading', { name: options.memberAccess ? 'Your household access' : 'Household access' })).toBeVisible();
  }
}

async function expectMinimumControlSize(scope: Locator) {
  const controls = scope.locator('button:visible, input:visible:not([type=checkbox]), label:has(input:visible)');
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const box = await controls.nth(index).boundingBox();
    expect(box, `control ${index} must have a box`).not.toBeNull();
    expect(box!.width, `control ${index} must expose a 44px-wide target`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `control ${index} must expose a 44px-tall target`).toBeGreaterThanOrEqual(44);
  }
}

test('desktop owner register exposes protected actions and opaque identifiers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openHousehold(page);
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible();
  await expect(page.getByText(householdFixtureIds.member).locator('xpath=ancestor-or-self::bdi')).toBeVisible();
  await expect(page.getByText(householdFixtureIds.invitation).locator('xpath=ancestor-or-self::bdi')).toBeVisible();
  await expect(page.getByRole('button', { name: `Promote ${householdFixtureIds.member} to owner` })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-owner-register.png'), fullPage: true });
});

test('invitation creation uses one protected command and never renders a token', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openHousehold(page);
  const opener = page.getByRole('button', { name: 'Invite member' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Create invitation record' });
  await expect(dialog.getByLabel('Member email')).toBeFocused();
  await dialog.getByLabel('Member email').fill('new.member@example.test');
  await dialog.getByRole('button', { name: 'Create invitation record' }).click();
  await expect(dialog.getByRole('status')).toContainText('Invitation record created');
  await expect(page.getByText(/invitation token/i)).toHaveCount(0);
  const audit = await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:55432/rest/v1/__fixture_audit');
    return response.json() as Promise<{ protectedMutationCalls: string[] }>;
  });
  expect(audit).toMatchObject({ protectedMutationCalls: ['create_household_invitation'] });
  await page.screenshot({ path: screenshotPath(testInfo, 'desktop-invitation-created.png') });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(opener).toBeFocused();
});

test('member view exposes only self access and leaving', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openHousehold(page, { memberAccess: true });
  await expect(page.getByRole('heading', { name: 'Access details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leave household' })).toBeVisible();
});

test('role changes require acknowledgement and refresh the protected roster', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openHousehold(page);
  await page.getByRole('button', { name: `Promote ${householdFixtureIds.member} to owner` }).click();
  const dialog = page.getByRole('dialog', { name: 'Promote to owner' });
  const confirm = dialog.getByRole('button', { name: 'Promote to owner' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await confirm.click();
  await expect(page.getByRole('button', { name: `Demote ${householdFixtureIds.member} to member` })).toBeVisible();
  const audit = await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:55432/rest/v1/__fixture_audit');
    return response.json() as Promise<{ protectedMutationCalls: string[] }>;
  });
  expect(audit.protectedMutationCalls).toContain('set_household_member_role');
});

test('failed household read recovers through the explicit retry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await openHousehold(page, { failHouseholdOnce: true });
  const error = page.getByRole('alert');
  await expect(error).toContainText('household request was not accepted');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Household access' })).toBeVisible();
});

test('mobile owner dialog is contained and restores focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openHousehold(page, { emptyInvitations: true });
  await expect(page.getByText('No invitation records yet.')).toBeVisible();
  const opener = page.getByRole('button', { name: 'Invite member' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Create invitation record' });
  await expect(dialog).toHaveCSS('min-height', '844px');
  await expectMinimumControlSize(dialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-invitation-dialog.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('mobile Arabic register mirrors safely without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await openHousehold(page);
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'إدارة المنزل' })).toBeVisible();
  await expect(page.getByText(householdFixtureIds.member).locator('xpath=ancestor-or-self::bdi')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: screenshotPath(testInfo, 'mobile-arabic-register.png'), fullPage: true });
});

test('fragment acceptance clears the secret and selects the new household', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installHouseholdApiFixture(page, { invitationAcceptance: true });
  await page.goto(`/#household-invitation=${TOKEN}`);
  await expect(page).toHaveURL('/');
  const dialog = page.getByRole('dialog', { name: 'Accept household invitation' });
  await dialog.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.locator('.space-current-name').getByText('Home budget')).toBeVisible();
  await expect(page).toHaveURL('/');
});
