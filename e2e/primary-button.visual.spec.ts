import { expect, test } from '@playwright/test';
import { installApplicationFixture } from './fixtures/application.js';
import { chooseWorkspaceDestination } from './workspace-navigation.js';

test('primary actions keep their filled style inside the workspace shell', async ({ page }, testInfo) => {
  await installApplicationFixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  await chooseWorkspaceDestination(page, 'Manage');
  await page.getByRole('button', { name: /^Wallets/ }).click();

  const primaryAction = page.getByRole('button', {
    name: testInfo.project.name === 'mobile' ? 'Add wallet' : 'Add transaction',
  });
  await expect(primaryAction).toBeVisible();
  // Browser projects may leave the pointer on the action; both rest and hover
  // must retain a filled green background rather than the shell reset.
  await expect(primaryAction).toHaveCSS('background-color', /rgb\((23, 127, 99|13, 93, 72)\)/);
  await expect(primaryAction).toHaveCSS('color', 'rgb(255, 255, 255)');
});
