import { expect, type Locator, type Page } from '@playwright/test';

export async function expectContainedControls(page: Page, scope: Locator = page.getByRole('main')) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  const overflow = await scope.locator('button:visible, input:visible, select:visible, textarea:visible, summary:visible').evaluateAll((controls) =>
    controls.filter((control) => {
      const box = control.getBoundingClientRect();
      if (!(box.left < -1 || box.right > document.documentElement.clientWidth + 1)) return false;
      // Controls clipped inside an on-screen horizontal scroller (filter
      // chips, primary navigation) are reachable by scrolling, not overflow.
      let ancestor = control.parentElement;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && ancestor.scrollWidth > ancestor.clientWidth + 1) {
          const ancestorBox = ancestor.getBoundingClientRect();
          if (ancestorBox.left >= -1 && ancestorBox.right <= document.documentElement.clientWidth + 1) return false;
        }
        ancestor = ancestor.parentElement;
      }
      return true;
    }).map((control) => ({ tag: control.tagName, label: control.getAttribute('aria-label') ?? control.textContent })),
  );
  expect(overflow).toEqual([]);
}

export async function expectDialogReturnsFocus(page: Page, opener: Locator, title: string) {
  await opener.click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await expectContainedControls(page, dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}
