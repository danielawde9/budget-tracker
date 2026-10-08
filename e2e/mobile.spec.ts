import { expect, test } from '@playwright/test';
import { localStackUp, signIn, storyUser } from './support.ts';

test('phone menus and forms stay within the screen in English and Arabic', async ({ page }) => {
  test.skip(!(await localStackUp()), 'Local demo unavailable; unverified.');
  await signIn(page, await storyUser());
  const phone = page.viewportSize()?.width ?? 390;
  await page.setViewportSize({ width: Math.min(phone, 390), height: 568 });
  for (const language of ['en', 'ar']) {
    if (language === 'ar') await page.getByRole('button', { name: 'Switch to Arabic' }).filter({ visible: true }).click();
    for (const route of ['home', 'plan', 'accounts', 'activity', 'settings']) {
      await page.goto(`/#/${route}`);
      await expect(page.locator('main h1')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.goto('/#/accounts');
    const menus = page.locator('.cr-account-menu');
    await expect(menus.first()).toBeVisible();
    for (let i = 0; i < await menus.count(); i++) {
      const menu = menus.nth(i);
      await menu.locator('summary').click();
      const panel = menu.locator('.cr-account-actions');
      await expect(panel).toBeVisible();
      await expect.poll(async () => {
        const rect = await panel.boundingBox();
        const size = page.viewportSize()!;
        return Boolean(rect && rect.x >= 7 && rect.y >= 7 && rect.x + rect.width <= size.width - 7 && rect.y + rect.height <= size.height - 7);
      }).toBe(true);
      for (const button of await panel.getByRole('button').all()) {
        await expect.poll(() => button.evaluate(el => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return hit === el || el.contains(hit);
        })).toBe(true);
      }
      await panel.getByRole('button').first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect.poll(() => dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  }
});

test('expense suggestions are tappable in a short viewport and keep keyboard navigation', async ({ page }) => {
  test.skip(!(await localStackUp()), 'Local demo unavailable; unverified.');
  await signIn(page, await storyUser());
  await page.setViewportSize({ width: 320, height: 420 });
  await page.getByRole('button', { name: 'Record', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Expense/ }).click();
  const description = dialog.getByRole('textbox', { name: 'Description', exact: true });
  await description.fill('Super');
  const suggestion = dialog.locator('.cr-description-suggestions button').filter({ hasText: 'Supermarket' });
  await expect(suggestion).toBeVisible();
  await expect(description).not.toHaveAttribute('list');
  await description.press('Tab');
  await expect(suggestion).toBeFocused();
  await suggestion.press('Enter');
  await expect(description).toHaveValue('Supermarket');
  await expect(description).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).not.toHaveValue('');
  await expect.poll(() => dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  await dialog.getByRole('textbox', { name: 'Amount', exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Record expense', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Saved successfully' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
