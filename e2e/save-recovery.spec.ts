import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { createBudgetApi } from '../src/api/budget-api.ts';
import { translate, type MessageKey } from '../src/lib/i18n.tsx';
import { formatMoney } from '../src/lib/money.ts';
import { budgetRowsets, localDemoEnv } from './local-database.ts';
import { localStackUp, signIn, storyUser } from './support.ts';

test.beforeAll(async () => { if (!(await localStackUp())) throw new Error('Start the local preview stack first.'); });
for (const locale of ['en', 'ar'] as const) {
  const t = (key: MessageKey) => translate(locale, key);
  async function setup(page: Page) {
    const user = await storyUser();
    const env = localDemoEnv();
    const client = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await client.auth.signInWithPassword(user);
    if (signed.error) throw signed.error;
    const api = createBudgetApi(client);
    const space = (await api.mySpaces())[0]!;
    const plan = await api.planMonth(space.id, space.currentMonth);
    const wallet = (await api.accounts(space.id)).wallets.find(wallet => wallet.name === 'Cash')!;
    const item = plan.groups.flatMap(group => group.items).find(item => item.nameEn === 'Groceries')!;
    await signIn(page, user);
    await expect(page.getByRole('region', { name: 'Your money', exact: true })).toBeVisible();
    await page.evaluate(locale => localStorage.setItem('budget:locale', locale), locale);
    await page.reload();
    await expect(page.getByRole('region', { name: t('home.moneyTitle'), exact: true })).toBeVisible();
    return { api, space, item, wallet };
  }
  async function expense(page: Page, itemId: string, walletId: string, memo: string) {
    await page.getByRole('button', { name: t('record.title'), exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: new RegExp(`^${t('record.kind.expense')}`) }).click();
    await dialog.getByLabel(t('record.description'), { exact: true }).fill(memo);
    await dialog.getByRole('textbox', { name: t('common.amount'), exact: true }).fill('1');
    await dialog.getByLabel(t('record.paidFrom'), { exact: true }).selectOption(walletId);
    await dialog.getByLabel(t('record.whatFor'), { exact: true }).selectOption(itemId);
    return dialog;
  }
  for (const recovery of ['same form', 'new form'] as const) {
    test(`lost committed reply finishes once from ${recovery} in ${locale}`, async ({ page }) => {
      const { api, space, item, wallet } = await setup(page);
      const before = (await api.overview(space.id)).currencies.find(currency => currency.currency === 'USD')!;
      const memo = `Lost reply ${randomUUID()}`;
      const requests: Record<string, unknown>[] = [];
      await page.route('**/rest/v1/rpc/record_expense', async route => {
        requests.push(route.request().postDataJSON() as Record<string, unknown>);
        if (requests.length === 1) {
          const response = await route.fetch();
          expect(response.ok()).toBe(true); // The real database commits before the browser loses its reply.
          await route.abort('connectionreset');
        } else await route.continue();
      });
      const dialog = await expense(page, item.itemId, wallet.id, memo);
      await dialog.getByRole('button', { name: t('record.saveExpense'), exact: true }).click();
      await expect(page.getByRole('alert', { name: t('recovery.title') }).first()).toBeVisible();
      expect((await api.activity(space.id)).entries.filter(entry => entry.memo === memo)).toHaveLength(1);
      if (recovery === 'same form') {
        await dialog.getByRole('button', { name: t('record.saveExpense'), exact: true }).click();
        await expect(dialog.getByRole('button', { name: t('common.done'), exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: t('common.done'), exact: true }).click();
      } else {
        await dialog.getByRole('button', { name: t('common.cancel'), exact: true }).click();
        await expect(dialog).toHaveCount(0);
        const fresh = await expense(page, item.itemId, wallet.id, `Fresh draft ${randomUUID()}`);
        await fresh.getByRole('button', { name: t('record.saveExpense'), exact: true }).click();
        await expect(fresh.getByRole('alert').filter({ hasText: t('error.SAVE_UNRESOLVED') })).toBeVisible();
        expect(requests).toHaveLength(1);
        await expect(page.getByRole('alert', { name: t('recovery.title') }).first()).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: t('common.close'), exact: true }).click();
        await page.getByRole('alert', { name: t('recovery.title') }).getByRole('button', { name: t('recovery.finish'), exact: true }).click();
        await expect(page.getByRole('alert', { name: t('recovery.title') })).toHaveCount(0);
      }
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
      expect(typeof requests[0]!.p_request).toBe('string');
      expect((await api.activity(space.id)).entries.filter(entry => entry.memo === memo)).toHaveLength(1);
      const after = (await api.overview(space.id)).currencies.find(currency => currency.currency === 'USD')!;
      expect(after.cashHeld).toBe(before.cashHeld - 100n);
      expect(after.setAside).toBe(before.setAside - 100n);
      expect(after.ready).toBe(before.ready);
      expect(after.cashHeld).toBe(after.setAside + after.ready);
      const money = page.getByRole('region', { name: t('home.moneyTitle'), exact: true });
      await money.locator('details.cr-money-breakdown summary').click();
      const equation = money.getByLabel(t('home.equationLabel'));
      await expect(equation).toBeVisible();
      for (const amount of [after.cashHeld, after.setAside, after.ready]) {
        await expect(equation).toContainText(formatMoney(amount, 'USD', locale));
      }
      await page.goto('/#/activity');
      await expect(page.getByRole('listitem').filter({ hasText: memo })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
  test(`cancel filled Expense, Fund, edited Plan and Correct preserves every budget row in ${locale}`, async ({ page }) => {
    const { api, space, item, wallet } = await setup(page);
    // Give the Fund form a real editable shortfall before taking the cancellation baseline.
    await api.assignMoney({ spaceId: space.id, requestId: randomUUID(), on: space.today, moves: [{ from: item.itemId, to: null, currency: 'USD', amount: 100n }] });
    await page.reload();
    const baseline = await budgetRowsets();
    await expense(page, item.itemId, wallet.id, `Cancelled ${randomUUID()}`);
    await page.getByRole('dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await budgetRowsets()).toEqual(baseline);
    await page.goto('/#/plan');
    await page.getByRole('button', { name: t('plan.fund'), exact: true }).click();
    await page.getByRole('dialog').locator('input[type="text"]').filter({ visible: true }).first().fill('1');
    await page.getByRole('dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await budgetRowsets()).toEqual(baseline);
    await page.getByRole('button', { name: t('plan.edit'), exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: t('plan.expectedIncome'), exact: true }).fill('9999');
    await page.getByRole('dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await budgetRowsets()).toEqual(baseline);
    await page.goto('/#/activity');
    await page.getByRole('listitem').filter({ hasText: 'Supermarket' }).first().getByRole('button').click();
    await page.getByRole('dialog').getByRole('button', { name: t('activity.correct'), exact: true }).click();
    await page.getByRole('dialog').getByLabel(t('correct.reason'), { exact: true }).fill('Do not save this correction');
    await page.getByRole('dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await budgetRowsets()).toEqual(baseline);
  });
}
