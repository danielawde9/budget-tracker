import { expect, test, type Page } from '@playwright/test';
import { expectEquation, localStackUp, moneyCard, newUser, signIn, signUp, storyUser } from './support.ts';

test.beforeEach(async () => {
  test.skip(!(await localStackUp()), 'The local preview stack is not running (pnpm preview:up). Reported as unverified, not passed.');
});

async function openRecord(page: Page, kind: string): Promise<void> {
  await page.getByRole('button', { name: 'Record', exact: true }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  if (!['Expense', 'Income', 'Change purpose'].includes(kind)) await dialog.getByText('More actions', { exact: true }).click();
  await dialog.getByRole('button', { name: new RegExp('^' + kind) }).click();
}

async function done(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('a fresh account: onboarding, income, funding, overspending and taking it back', async ({ page }) => {
  const user = newUser();
  await signUp(page, user);

  // 1 · Setup from zero.
  await page.getByLabel('Expected income').fill('4110');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Keep defaults' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Bank');
  await page.getByRole('button', { name: 'Save wallet and continue' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expectEquation(page, '$0.00', '$0.00', '$0.00');

  // 3 · Income arrives; Fund my plan proposes the whole plan.
  await openRecord(page, 'Income');
  await page.getByRole('dialog').getByLabel('Amount').fill('4110');
  await page.getByRole('dialog').getByRole('button', { name: 'Record income' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fund my plan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Set aside' }).click();
  await expect(page.getByRole('dialog').getByText('Set aside $4,110.00.')).toBeVisible();
  await done(page);
  await expectEquation(page, '$4,110.00', '$4,110.00', '$0.00');

  // 5 · Spending more than an item holds is covered at once — here from Ready to assign, which goes over.
  await openRecord(page, 'Expense');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Description').fill('Supermarket');
  await dialog.getByLabel('Amount').fill('50');
  await dialog.getByLabel('What was it for?').selectOption({ label: 'Groceries — $0.00' });
  await expect(dialog.getByText('Groceries has $0.00. Take the missing $50.00 from:')).toBeVisible();
  await expect(dialog.getByText(/over-assigned by \$50\.00/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Record expense' }).click();
  await done(page);
  await expect(moneyCard(page).getByRole('heading', { name: 'Over-assigned', exact: true })).toBeVisible();
  await expectEquation(page, '$4,060.00', '$4,110.00', '-$50.00');

  // Taking money back from an item restores the balance.
  await page.getByRole('button', { name: 'Take back' }).click();
  const move = page.getByRole('dialog');
  await move.getByLabel('From', { exact: true }).selectOption({ label: 'Other essentials — $2,466.00' });
  await move.getByLabel('To', { exact: true }).selectOption({ label: 'Ready to assign — -$50.00' });
  await move.getByLabel('Amount').fill('50');
  await move.getByRole('button', { name: 'Move now', exact: true }).click();
  await done(page);
  await expectEquation(page, '$4,060.00', '$4,060.00', '$0.00');

  // 7 · Reassigning savings to a goal changes purposes only.
  await openRecord(page, 'Change purpose');
  const reassign = page.getByRole('dialog');
  await reassign.getByLabel('From', { exact: true }).selectOption({ label: 'General savings — $411.00' });
  await reassign.getByLabel('To', { exact: true }).selectOption({ label: 'Goals money — $616.50' });
  await reassign.getByLabel('Amount').fill('150');
  await reassign.getByRole('button', { name: 'Move now', exact: true }).click();
  await done(page);
  await expectEquation(page, '$4,060.00', '$4,060.00', '$0.00');
  await page.getByText('Plan details', { exact: true }).click();
  const groups = page.getByRole('region', { name: 'Set aside by group' });
  await expect(groups.getByRole('listitem').filter({ hasText: 'Savings' })).toContainText('$261.00');
  await expect(groups.getByRole('listitem').filter({ hasText: 'Short-term goals' })).toContainText('$766.50');

  // A repeat expense: its description brings back the item and amount. The only wallet is shown, not chosen.
  await openRecord(page, 'Expense');
  const repeat = page.getByRole('dialog');
  await expect(repeat.getByText(/Start typing to reuse a past expense/)).toBeVisible();
  await expect(repeat.getByRole('combobox', { name: 'Paid from' })).toHaveCount(0);
  await expect(repeat.getByText('Paid from')).toBeVisible();
  await repeat.getByLabel('Description').fill('supermarket');
  await expect(repeat.getByLabel('Amount')).toHaveValue('50');
  await expect(repeat.getByLabel('What was it for?').locator('option:checked')).toHaveText(/^Groceries/);
  await repeat.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('existing money: pay a bill, update an investment, repay a loan, read last month', async ({ page }) => {
  const user = await storyUser();
  await signIn(page, user);
  await expectEquation(page, '$8,712.60', '$7,392.60', '$1,320.00');

  // 10 · A bill reads its item; paying it is one deduction from that item.
  await page.getByText('Upcoming bills', { exact: true }).first().click();
  const bills = page.getByRole('region', { name: 'Upcoming bills' });
  await bills.getByRole('listitem').filter({ hasText: 'Internet' }).getByRole('button', { name: 'Pay' }).click();
  const pay = page.getByRole('dialog');
  await expect(pay.getByText(/Paying Internet/)).toBeVisible();
  await pay.getByRole('button', { name: 'Record expense' }).click();
  await done(page);
  await expectEquation(page, '$8,667.60', '$7,347.60', '$1,320.00');
  await expect(bills.getByRole('listitem').filter({ hasText: 'Internet' })).toHaveCount(0);

  // 9 · A value update is a gain, kept apart from contributions.
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  const brokerage = page.getByRole('listitem').filter({ hasText: 'Brokerage' });
  await brokerage.locator('summary').click();
  await brokerage.getByRole('button', { name: 'What is it worth now?' }).click();
  const value = page.getByRole('dialog');
  await value.getByLabel('New total value').fill('13100');
  await value.getByRole('button', { name: 'Record' }).click();
  await done(page);
  await expect(brokerage).toContainText('contributed $12,822.00 · gain +$278.00');

  // 10 · Repaying: principal reduces the debt; interest is spending.
  const loan = page.getByRole('listitem').filter({ hasText: 'Car loan' });
  await loan.locator('summary').click();
  await loan.getByRole('button', { name: 'Repay what I owe' }).click();
  const repay = page.getByRole('dialog');
  await repay.getByLabel('Principal').fill('100');
  await repay.getByText('Interest and fees (optional)', { exact: true }).click();
  await repay.getByLabel('Interest paid').fill('10');
  await expect(repay.getByText('$110.00 leaves your wallet: $100.00 debt repaid, $10.00 interest and fees.')).toBeVisible();
  await repay.getByRole('button', { name: 'Record' }).click();
  await done(page);
  await expect(loan).toContainText('$5,558.00');

  // 2 / 6 · Last month shows the opening balances apart from funding.
  await page.getByRole('link', { name: 'Plan' }).first().click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  const shortTerm = page.locator('details.cr-group').filter({ hasText: 'Short-term goals' });
  await shortTerm.locator(':scope > summary').click();
  await expect(shortTerm.getByRole('row').filter({ hasText: 'Holiday' })).toContainText('$800.00 opening balance');
});

test.describe('Arabic on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('mirrors right to left and never scrolls sideways', async ({ page }) => {
    const user = await storyUser();
    await signIn(page, user);
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Switch to Arabic' }).filter({ visible: true }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الرئيسية', level: 1 })).toBeVisible();
    for (const hash of ['#/home', '#/plan', '#/activity', '#/accounts']) {
      await page.goto(`/${hash}`);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, hash).toBeLessThanOrEqual(0);
    }
  });
});
