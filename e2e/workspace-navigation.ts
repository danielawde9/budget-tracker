import { expect, type Locator, type Page } from '@playwright/test';

// The Control Room shell always shows its navigation: a left rail on desktop
// and a bottom tab bar on mobile. Both carry the same "Workspace" label, so
// scope lookups to the visible one.
export async function openWorkspaceNavigation(page: Page): Promise<Locator> {
  const navigation = page.getByRole('navigation', { name: /^(Workspace|مساحة العمل)$/ }).filter({ visible: true }).first();
  await expect(navigation).toBeVisible();
  return navigation;
}

async function openManageSections(page: Page) {
  const navigation = await openWorkspaceNavigation(page);
  await navigation.getByRole('button', { name: /^(Manage|الإدارة)$/ }).click();
  // Already inside a Manage section, the sections menu hides behind a back
  // button; the menu nav assertion auto-waits for either state.
  const back = page.getByRole('button', { name: /^(Back to manage sections|عودة إلى أقسام الإدارة)$/ });
  if (await back.isVisible().catch(() => false)) await back.click();
  await expect(page.getByRole('navigation', { name: /^(Manage sections|أقسام الإدارة)$/ })).toBeVisible();
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
  const html = page.locator('html');
  const dir = await html.getAttribute('dir');
  await page.getByRole('button', { name: /^(Language|اللغة)/ }).click();
  // The language toggle lives on the Manage menu; return to Home so callers
  // keep the same "language changed in place" semantics as the old shell.
  await expect(html).toHaveAttribute('dir', dir === 'rtl' ? 'ltr' : 'rtl');
  const navigation = await openWorkspaceNavigation(page);
  await navigation.getByRole('button', { name: dir === 'rtl' ? 'Home' : 'الرئيسية', exact: true }).click();
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
