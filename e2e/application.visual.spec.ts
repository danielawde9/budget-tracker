import { expect, test, type TestInfo } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/application-shell/${name}`
    : testInfo.outputPath(name);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('signed-out desktop keeps financial content private', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page, { authenticated: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'العربية' })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.getByText('Maya')).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'signed-out-desktop.png'), fullPage: true });
});

test('sign-in failure preserves email and a later retry opens Loans', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page, { authenticated: false, failFirstSignIn: true });
  await page.goto('/');
  const email = page.getByLabel('Email');
  await email.fill('manager@example.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Sign-in was not accepted');
  await expect(email).toHaveValue('manager@example.test');
  await page.screenshot({ path: screenshotPath(testInfo, 'sign-in-error-desktop.png'), fullPage: true });
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Loans' })).toBeVisible();
  await expect(page.getByText('Maya')).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'sign-in-recovery-desktop.png'), fullPage: true });
});

test('first-time onboarding creates a personal space and first wallet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page, { emptySpaces: true });
  await page.goto('/');
  const setup = page.getByRole('dialog', { name: 'Create your first space' });
  await expect(setup).toBeVisible();
  await setup.getByLabel('Space name').fill('My first space');
  await setup.getByRole('button', { name: 'Create personal space' }).click();
  await expect(page.getByRole('heading', { name: 'Add your first wallet' })).toBeVisible();
  await page.getByLabel('Wallet name').fill('Daily USD');
  await page.getByRole('button', { name: 'Create USD wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Loans' })).toBeVisible();
  await expect(page.getByText('Maya')).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'onboarding-complete-desktop.png'), fullPage: true });
});

test('existing user switches spaces without retaining old content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page);
  await page.goto('/');
  await expect(page.getByText('Maya')).toBeVisible();
  await page.getByRole('combobox', { name: 'Current space' }).selectOption('household-space');
  await expect(page.locator('.space-current-name bdi')).toHaveText('Home budget');
  await expect(page.getByRole('heading', { name: 'Loans' })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'multi-space-desktop.png'), fullPage: true });
});

test('mobile onboarding is full-screen, trapped, and not dismissible before setup', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await installApplicationFixture(page, { emptySpaces: true });
  await page.goto('/');
  const setup = page.getByRole('dialog', { name: 'Create your first space' });
  await expect(setup).toHaveCSS('min-height', '844px');
  await page.keyboard.press('Escape');
  await expect(setup).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(setup).toContainText('Create your first space');
  await page.screenshot({ path: screenshotPath(testInfo, 'onboarding-mobile.png') });
});

test('Arabic mobile shell mirrors global and Loans controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await installApplicationFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('combobox', { name: 'المساحة الحالية' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'القروض' })).toBeVisible();
  await expect(page.getByText('Maya').first()).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, 'arabic-shell-mobile.png'), fullPage: true });
});

test('ambiguous space creation reconciles before continuing to wallet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await installApplicationFixture(page, { emptySpaces: true, ambiguousSpaceOnce: true });
  await page.goto('/');
  const setup = page.getByRole('dialog', { name: 'Create your first space' });
  await setup.getByLabel('Space name').fill('Recovered home');
  await setup.getByRole('radio', { name: 'Household space' }).check();
  await setup.getByRole('button', { name: 'Create household space' }).click();
  await expect(page.getByRole('heading', { name: 'Add your first wallet' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'ambiguous-space-recovered-mobile.png') });
});

test('sign-out followed by another user starts a fresh authenticated shell', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page);
  await page.goto('/');
  await expect(page.getByText('Maya')).toBeVisible();
  await page.getByText('Account').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Maya')).toHaveCount(0);
  await page.getByLabel('Email').fill('second@example.test');
  await page.getByLabel('Password').fill('second-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Maya')).toBeVisible();
  await page.getByText('Account').click();
  await expect(page.locator('.account-popover bdi')).toHaveText('second@example.test');
});
