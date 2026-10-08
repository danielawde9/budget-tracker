import { expect, test } from '@playwright/test';
import { localStackUp, signIn, storyUser } from './support.ts';

test('exchange confirmation supports keyboard completion and a fresh repeat', async ({ page }) => {
  test.skip(!(await localStackUp()), 'Local preview unavailable; unverified.');
  await signIn(page, await storyUser());
  const opener = page.getByRole('button', { name: 'Record', exact: true }).filter({ visible: true }).first();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('More actions', { exact: true }).click();
  await dialog.getByRole('button', { name: /^Exchange/ }).click();
  await dialog.getByLabel('You gave').fill('1');
  await dialog.getByLabel('You got').fill('89500');
  let writes = 0;
  page.on('request', request => { if (request.url().includes('/rpc/record_exchange')) writes++; });
  await dialog.getByRole('button', { name: 'Record exchange' }).click();
  await expect(dialog.getByRole('heading', { name: 'Exchange recorded' })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('Exchange recordedExchanged $1.00 for LBP 89,500.');
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  expect(writes).toBe(1);
  await dialog.getByRole('button', { name: 'Record another' }).click();
  await expect(dialog.getByLabel('You gave')).toHaveValue('');
  await expect(dialog.getByLabel('You got')).toHaveValue('');
  expect(writes).toBe(1);
  await dialog.getByLabel('You gave').fill('1');
  await dialog.getByLabel('You got').fill('89500');
  await dialog.getByRole('button', { name: 'Record exchange' }).click();
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  expect(writes).toBe(2);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});


test('record dialog close button and backdrop dismiss restore focus', async ({ page }) => {
  test.skip(!(await localStackUp()), 'Local preview unavailable; unverified.');
  await signIn(page, await storyUser());
  const opener = page.getByRole('button', { name: 'Record', exact: true }).filter({ visible: true }).first();
  await opener.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  // Mobile dialogs fill the viewport, so there is no exposed backdrop.
  if ((page.viewportSize()?.width ?? 1440) <= 680) await page.keyboard.press('Escape');
  else await page.mouse.click(10, 10);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});
