import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { createBudgetApi } from '../src/api/budget-api.ts';
import { translate, type MessageKey } from '../src/lib/i18n.tsx';
import { formatMoney, toInputText } from '../src/lib/money.ts';
import { budgetRowsets, localDemoEnv } from './local-database.ts';
import { localStackUp, signIn, storyUser } from './support.ts';

test.beforeAll(async () => { if (!(await localStackUp())) throw new Error('Start the local preview stack first.'); });

for (const locale of ['en', 'ar'] as const) {
  for (const width of [320, 390]) {
    test(`statement comparison is read-only and linked in ${locale} at ${width}px`, async ({ page }) => {
      const t = (key: MessageKey) => translate(locale, key);
      const user = await storyUser();
      const env = localDemoEnv();
      const client = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await client.auth.signInWithPassword(user);
      if (signed.error) throw signed.error;
      const api = createBudgetApi(client);
      const space = (await api.mySpaces())[0]!;
      const wallets = (await api.accounts(space.id)).wallets.filter(wallet => wallet.kind === 'cash');
      const before = await budgetRowsets();
      await page.setViewportSize({ width, height: 568 });
      await signIn(page, user);
      await expect(page.getByRole('region', { name: 'Your money', exact: true })).toBeVisible();
      await page.evaluate(locale => localStorage.setItem('budget:locale', locale), locale);
      await page.reload();
      await expect(page.getByRole('region', { name: t('home.moneyTitle'), exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

      const writes: string[] = [];
      const reads: string[] = [];
      page.on('request', request => {
        const name = /\/rest\/v1\/rpc\/([^/?]+)/.exec(request.url())?.[1];
        if (!name) return;
        const body = request.postDataJSON() as Record<string, unknown> | null;
        if (body && 'p_request' in body) writes.push(name);
        reads.push(name);
      });
      async function openCheck(walletName: string) {
        await page.goto('/#/accounts');
        const row = page.locator('.cr-account-row').filter({ has: page.locator('.cr-register-title', { hasText: new RegExp(`^${walletName}$`) }) });
        await row.locator('summary').click();
        await row.getByRole('button', { name: t('statement.check'), exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
      }
      async function checkLayout() {
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      }
      for (const currency of ['USD', 'LBP'] as const) {
        const wallet = wallets.find(wallet => wallet.currency === currency)!;
        const expected = await api.walletBalanceOn(space.id, wallet.id, space.today);
        const difference = currency === 'USD' ? 125n : 1000n;
        const observed = expected.balance + difference;
        const latin = toInputText(observed, currency);
        const input = locale === 'ar' ? latin.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]!).replace('.', '٫') : latin;
        await openCheck(wallet.name);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText(t('statement.readOnly'), { exact: true })).toBeVisible();
        await expect(dialog.getByLabel(t('statement.date'), { exact: true })).toHaveValue(space.today);
        await dialog.getByLabel(t('statement.balance'), { exact: true }).fill(input);
        reads.length = 0;
        const responsePromise = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/wallet_balance_on') && response.request().postDataJSON().p_wallet === wallet.id);
        await dialog.getByRole('button', { name: t('statement.compare'), exact: true }).click();
        const response = await responsePromise;
        expect(response.ok()).toBe(true);
        expect(await response.json()).toMatchObject({ walletId: wallet.id, on: space.today, balance: expected.balance.toString() });
        await expect(dialog.locator('p').filter({ hasText: t('statement.more') })).toBeVisible();
        await expect(dialog.locator('bdi.cr-amount').filter({ hasText: formatMoney(difference, currency, locale) })).toBeVisible();
        expect(reads).toEqual(['wallet_balance_on']);
        expect(writes).toEqual([]);
        await checkLayout();
        const activity = dialog.getByRole('link', { name: t('statement.activity'), exact: true });
        await expect(activity).toHaveAttribute('href', `#/activity?wallet=${wallet.id}&month=${space.today.slice(0, 7)}`);
        await activity.click();
        await expect(page.getByRole('heading', { name: t('nav.activity'), level: 1 })).toBeVisible();
        await expect(page.getByLabel(t('common.wallet'), { exact: true })).toHaveValue(wallet.id);
        await expect(page.getByLabel(t('activity.month'), { exact: true })).toHaveValue(space.currentMonth);
        await openCheck(wallet.name);
        await page.getByRole('dialog').getByLabel(t('statement.balance'), { exact: true }).fill(input);
        await page.getByRole('dialog').getByRole('button', { name: t('statement.compare'), exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: t('statement.record'), exact: true }).click();
        await expect(page.getByRole('dialog').getByLabel(t('record.paidFrom'), { exact: true })).toHaveValue(wallet.id);
        await page.getByRole('dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      expect(writes).toEqual([]);
      expect(await budgetRowsets()).toEqual(before);
    });
  }
}
