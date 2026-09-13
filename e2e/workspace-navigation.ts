import { expect, type Locator, type Page } from '@playwright/test';

// The Control Room shell always shows its navigation: a left rail on desktop
// and a bottom tab bar on mobile. Both carry the same "Workspace" label, so
// scope lookups to the visible one.
export async function openWorkspaceNavigation(page: Page): Promise<Locator> {
  return page.getByRole('navigation', { name: /^(Workspace|مساحة العمل)$/ }).filter({ visible: true }).first();
}

async function openManageSections(page: Page) {
  const navigation = await openWorkspaceNavigation(page);
  await navigation.getByRole('button', { name: /^(Manage|الإدارة)$/ }).click();
  const back = page.getByRole('button', { name: /^(Back to manage sections|عودة إلى أقسام الإدارة)$/ });
  if (await back.isVisible()) await back.click();
}

export async function chooseWorkspaceDestination(page: Page, name: string) {
  const navigation = await openWorkspaceNavigation(page);
  const direct = navigation.getByRole('button', { name, exact: true });
  if ((await direct.count()) > 0) {
    await direct.click();
    return;
  }
  // Feature pages (Wallets, Categories, Loans, Household) live under Manage.
  await openManageSections(page);
  await page.getByRole('navigation', { name: /^(Manage sections|أقسام الإدارة)$/ }).getByRole('button', { name, exact: true }).click();
}

export async function switchWorkspaceLanguage(page: Page) {
  await openManageSections(page);
  await page.getByRole('button', { name: /^(Language|اللغة)/ }).click();
  // The language toggle lives on the Manage menu; return to Home so callers
  // keep the same "language changed in place" semantics as the old shell.
  const dir = await page.locator('html').getAttribute('dir');
  const navigation = await openWorkspaceNavigation(page);
  await navigation.getByRole('button', { name: dir === 'rtl' ? 'الرئيسية' : 'Home', exact: true }).click();
}

export async function switchWorkspaceSpace(page: Page, currentSpace: string, nextSpace: string) {
  const navigation = await openWorkspaceNavigation(page);
  await navigation.getByRole('button', { name: currentSpace, exact: true }).click();
  await page.getByRole('menuitem', { name: nextSpace, exact: true }).click();
}

export async function openWorkspaceAccount(page: Page, accountLabel: string) {
  await openManageSections(page);
  const account = page.getByRole('group', { name: accountLabel, exact: true });
  await expect(account).toBeVisible();
  return account;
}
