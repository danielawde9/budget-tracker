import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { createBudgetApi } from '../src/api/budget-api.ts';
import { translate } from '../src/lib/i18n.tsx';
import { formatMoney } from '../src/lib/money.ts';
import { localDemoEnv } from './local-database.ts';
import { localStackUp, signIn, storyUser } from './support.ts';

test.beforeAll(async () => {
  if (!(await localStackUp())) throw new Error('The real local preview database is required.');
});

test('dashboard charts display recorded history and follow currency and activity filters', async ({ page }) => {
  const user = await storyUser();
  const env = localDemoEnv();
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await client.auth.signInWithPassword(user);
  if (auth.error) throw auth.error;
  const api = createBudgetApi(client);
  const space = (await api.mySpaces())[0]!;
  const history = await api.moneyHistory(space.id);
  const latest = history.months.at(-1)!;
  expect(history.months.length).toBeGreaterThan(1);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page, user);

  const income = page.getByRole('region', { name: 'Income vs spending', exact: true });
  const savings = page.getByRole('region', { name: 'Savings over time', exact: true });
  await expect(income.getByText(formatMoney(latest.income.USD, 'USD', 'en'), { exact: true })).toBeVisible();
  await expect(income.getByText(formatMoney(latest.spent.USD, 'USD', 'en'), { exact: true })).toBeVisible();
  await expect(savings.getByText(formatMoney(latest.savings.USD, 'USD', 'en'), { exact: true })).toBeVisible();
  const daily = page.getByRole('region', { name: 'Actual vs. planned expenses', exact: true });
  await daily.getByRole('slider', { name: 'Explore spending by day' }).press('Home');
  await expect(daily.getByRole('slider')).toHaveValue('1');
  await daily.getByRole('button', { name: 'Latest day' }).click();
  await page.getByRole('group', { name: 'Currency', exact: true }).getByRole('button', { name: 'LBP', exact: true }).click();
  await expect(income.locator('.cr-chart-readout .cr-amount').first()).toHaveText(formatMoney(latest.income.LBP, 'LBP', 'en'));
  await expect(savings.locator('.cr-chart-readout .cr-amount')).toHaveText(formatMoney(latest.savings.LBP, 'LBP', 'en'));
  await income.getByRole('button').first().click();
  const earliest = history.months[0]!;
  await expect(income.locator('.cr-chart-readout .cr-amount').first()).toHaveText(formatMoney(earliest.income.LBP, 'LBP', 'en'));

  await page.goto('/#/plan');
  await expect(page.getByRole('region', { name: 'Planned vs spent', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your budget at a glance', exact: true }).getByRole('img')).toBeVisible();
  const mix = page.getByRole('region', { name: 'Your budget at a glance', exact: true });
  const essentials = mix.getByRole('button', { name: /Essentials/ });
  await essentials.click();
  await expect(essentials).toHaveAttribute('aria-pressed', 'true');
  await mix.getByRole('button', { name: 'Show total budget' }).click();
  await expect(essentials).toHaveAttribute('aria-pressed', 'false');
  const category = page.getByRole('region', { name: 'Planned vs spent', exact: true }).locator('summary').filter({ hasText: 'Essentials' });
  await category.click();
  await expect(category.locator('..').getByText('Item breakdown')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Funding progress', exact: true }).getByRole('progressbar').first()).toBeVisible();

  await page.goto('/#/activity');
  await expect(page.getByRole('img', { name: 'Records by day', exact: true })).toBeVisible();
  const day = page.getByRole('group', { name: 'Filter loaded records by day' }).getByRole('button').first();
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Show all loaded days' }).click();
  const search = page.getByRole('searchbox');
  await search.fill('no-matching-dashboard-record');
  await expect(page.getByText('0 · Matching records', { exact: true })).toBeVisible();
  await expect(page.getByText('Matching activity will appear here.', { exact: true })).toBeVisible();
  await search.clear();
  await expect(page.getByRole('img', { name: 'Records by day', exact: true })).toBeVisible();

  await page.goto('/#/accounts');
  const bank = page.locator('.cr-account-row').filter({ has: page.locator('.cr-register-title', { hasText: /^Bank$/ }) });
  await bank.getByRole('button', { name: 'Expense', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Paid from', { exact: true })).toHaveValue((await api.accounts(space.id)).wallets.find(wallet => wallet.name === 'Bank')!.id);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('all redesigned destinations fit the viewport in English and Arabic', async ({ page }, testInfo) => {
  await signIn(page, await storyUser());
  for (const locale of ['en', 'ar'] as const) {
    if (locale === 'ar') await page.getByRole('button', { name: 'Switch to Arabic', exact: true }).filter({ visible: true }).click();
    for (const destination of ['home', 'plan', 'activity', 'accounts', 'settings'] as const) {
      await page.goto(`/#/${destination}`);
      await expect(page.getByRole('heading', { level: 1, name: translate(locale, `nav.${destination}`), exact: true })).toBeVisible();
      await expect(page.locator('main').getByText(translate(locale, 'common.loading'), { exact: true })).toHaveCount(0);
      await expect(page.locator('main .error-notice')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (destination === 'home') await expect(page.getByRole('region', { name: locale === 'en' ? 'Income vs spending' : 'الدخل مقابل الإنفاق', exact: true }).getByRole('img')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${destination}-${locale}.png`), fullPage: true });
    }
  }
});

test('tablet plan values retain labels and daily activity counts are keyboard accessible', async ({ page }) => {
  await signIn(page, await storyUser());
  await page.setViewportSize({ width: 690, height: 1000 });
  await page.goto('/#/plan');
  const cells = page.locator('.cr-plan-table').first().locator('tbody tr').first().locator('td[data-label]');
  await expect(cells).toHaveCount(4);
  for (const cell of await cells.all()) {
    expect(await cell.evaluate(element => getComputedStyle(element, '::before').display)).toBe('block');
  }
  await page.goto('/#/activity');
  const disclosure = page.locator('summary').filter({ hasText: 'Daily activity counts' });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: 'Records by day', exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Records', exact: true })).toBeVisible();
  expect(await table.getByRole('row').count()).toBeGreaterThan(1);
});
