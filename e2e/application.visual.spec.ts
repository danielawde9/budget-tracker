import { expect, test, type TestInfo } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { expectContainedControls } from './workspace-contract.js';

function screenshotPath(testInfo: TestInfo, name: string) {
  return process.env['UPDATE_VISUAL_ARTIFACTS'] === '1'
    ? `artifacts/application-shell/${name}`
    : testInfo.outputPath(name);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const locale of ['en', 'ar'] as const) {
  test(`Home default, bounded content, real routes and contained ${locale} controls`, async ({ page }, testInfo) => {
    await installApplicationFixture(page);
    const historyRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/financial_events') && url.searchParams.has('offset');
    });
    await page.goto('/');
    const historyUrl = new URL((await historyRequest).url());
    expect(historyUrl.searchParams.get('offset')).toBe('0');
    expect(historyUrl.searchParams.get('limit')).toBe('21');
    if (locale === 'ar') await page.getByRole('button', { name: 'العربية' }).click();
    const ar = locale === 'ar';
    const navigation = page.getByRole('navigation');
    await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
    await expect(navigation.getByRole('button', { name: ar ? 'الرئيسية' : 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(navigation.getByRole('button', { name: /Reports|التقارير/ })).toHaveCount(0);
    await expect(navigation.locator('button:disabled')).toHaveCount(0);
    const balances = page.getByRole('region', { name: ar ? 'الأرصدة الفعالة' : 'Active balances' });
    await expect(balances.getByRole('listitem')).toHaveCount(3);
    await expect(balances.getByText('Daily USD', { exact: true })).toBeVisible();
    const activity = page.getByRole('region', { name: ar ? 'النشاط الأخير' : 'Recent activity' });
    await expect(activity.locator('ol > li')).toHaveCount(7);
    await page.screenshot({ path: screenshotPath(testInfo, `home-${locale}-${testInfo.project.name}.png`), fullPage: true });
    await expectContainedControls(page);

    await page.getByRole('button', { name: ar ? 'عرض المحافظ' : 'View wallets', exact: true }).click();
    await expect(page.getByRole('heading', { name: ar ? 'المحافظ' : 'Wallets', exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: ar ? 'المحافظ' : 'Wallets', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test(`Wallets, Loans and Categories ${locale} primary routes remain contained`, async ({ page }, testInfo) => {
    await installApplicationFixture(page);
    await page.goto('/');
    const ar = locale === 'ar';
    if (ar) await page.getByRole('button', { name: 'العربية' }).click();
    for (const [name, destination] of [['wallets', ar ? 'المحافظ' : 'Wallets'], ['loans', ar ? 'القروض' : 'Loans'], ['categories', ar ? 'الفئات' : 'Categories']] as const) {
      await page.getByRole('navigation').getByRole('button', { name: destination, exact: true }).click();
      await expect(page.getByRole('heading', { name: destination, exact: true })).toBeVisible();
      await expectContainedControls(page);
      await page.screenshot({ path: screenshotPath(testInfo, `${name}-${locale}-${testInfo.project.name}.png`), fullPage: true });
    }
  });
}

test('Home transaction action enters the real Wallets transaction dialog', async ({ page }) => {
  await installApplicationFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Record transaction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Wallets', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('empty Home explains the prerequisite and routes to wallet creation', async ({ page }) => {
  await installApplicationFixture(page, { emptyWallets: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Record transaction', exact: true })).toBeDisabled();
  await expect(page.getByText('Create an active wallet before recording a transaction.')).toBeVisible();
  await page.getByRole('button', { name: 'Create a wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create first wallet' })).toBeVisible();
});

test('signed-out desktop keeps financial content private', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page, { authenticated: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'العربية' })).toHaveCSS('color', 'rgb(23, 35, 29)');
  await expect(page.getByText('Maya')).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'signed-out-desktop.png'), fullPage: true });
});

test('narrow signed-out auth stays within the viewport in English and Arabic', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.setViewportSize({ width: 320, height: 568 });
  await installApplicationFixture(page, { authenticated: false });
  await page.goto('/');

  for (const language of ['en', 'ar'] as const) {
    const boundary = page.locator('.auth-boundary');
    await expect(boundary).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const box = await boundary.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    if (language === 'en') await page.getByRole('button', { name: 'العربية' }).click();
  }
});

test('sign-in failure preserves email and a later retry opens Home', async ({ page }, testInfo) => {
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
  await expect(page.getByRole('heading', { name: 'Active balances' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Active balances' }).getByText('Daily USD')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Active balances' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Active balances' }).getByText('Daily USD')).toBeVisible();
  await expect(page.getByText('No transactions yet')).toBeVisible();
  await expect(page.getByText('Maya')).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, 'onboarding-complete-desktop.png'), fullPage: true });
});

test('existing user switches spaces without retaining old content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await installApplicationFixture(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Active balances' }).getByText('Daily USD')).toBeVisible();
  await page.getByRole('combobox', { name: 'Current space' }).selectOption('household-space');
  await expect(page.locator('.space-current-name bdi')).toHaveText('Home budget');
  await expect(page.getByRole('region', { name: 'Active balances' }).getByText('Household USD')).toBeVisible();
  await expect(page.getByText('Daily USD')).toHaveCount(0);
  await expect(page.getByText('No transactions yet')).toBeVisible();
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

test('Arabic mobile shell mirrors global and Home controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await installApplicationFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('combobox', { name: 'المساحة الحالية' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'الأرصدة الفعالة' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'الأرصدة الفعالة' }).getByText('Daily USD')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Active balances' })).toBeVisible();
  await page.getByText('Account').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Daily USD')).toHaveCount(0);
  await page.getByLabel('Email').fill('second@example.test');
  await page.getByLabel('Password').fill('second-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Active balances' })).toBeVisible();
  await page.getByText('Account').click();
  await expect(page.getByText('second@example.test').locator('xpath=ancestor-or-self::bdi')).toBeVisible();
});
