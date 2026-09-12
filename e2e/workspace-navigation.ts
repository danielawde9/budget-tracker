import { type Page } from '@playwright/test';

function usesMobileNavigation(page: Page) {
  return page.viewportSize()!.width < 1024;
}

export async function openWorkspaceNavigation(page: Page) {
  if (!usesMobileNavigation(page)) return page.getByRole('navigation');

  await page.getByRole('button', { name: /^(Menu|القائمة)$/ }).click();
  return page.getByRole('dialog', { name: /^(Navigation menu|قائمة التنقل)$/ });
}

async function closeWorkspaceNavigation(page: Page) {
  const closeMenu = page.getByRole('button', { name: /^(Close menu|إغلاق القائمة)$/ });
  if (await closeMenu.isVisible()) await closeMenu.click();
}

export async function chooseWorkspaceDestination(page: Page, name: string) {
  const navigation = await openWorkspaceNavigation(page);
  await navigation.getByRole('button', { name, exact: true }).click();
}

export async function switchWorkspaceLanguage(page: Page) {
  if (usesMobileNavigation(page)) await openWorkspaceNavigation(page);
  await page.getByRole('button', { name: 'العربية' }).click();
  await closeWorkspaceNavigation(page);
}

export async function switchWorkspaceSpace(page: Page, currentSpace: string, nextSpace: string) {
  if (usesMobileNavigation(page)) await openWorkspaceNavigation(page);
  await page.getByRole('button', { name: currentSpace, exact: true }).click();
  await page.getByRole('menuitem', { name: nextSpace, exact: true }).click();
  await closeWorkspaceNavigation(page);
}

export async function openWorkspaceAccount(page: Page, accountLabel: string) {
  const scope = usesMobileNavigation(page) ? await openWorkspaceNavigation(page) : page;
  await scope.getByText(accountLabel, { exact: true }).click();
  return scope;
}
