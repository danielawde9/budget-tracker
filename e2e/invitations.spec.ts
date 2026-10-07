import { test, expect } from '@playwright/test';
import { localStackUp, newUser, storyUser, signIn } from './support.ts';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

test('owner creates an invite in Settings and recipient joins the same space', async ({ page, browser }, testInfo) => {
  test.skip(!(await localStackUp()), 'Start the local preview stack first.');
  const owner = await storyUser();
  const recipient = newUser();
  const env = readFileSync('.env.demo.local', 'utf8');
  const value = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '';
  const client = createClient(value('VITE_SUPABASE_URL'), value('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const signup = await client.auth.signUp(recipient);
  expect(signup.error).toBeNull();
  await signIn(page, owner);
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Invite a member' })).toBeVisible();
  await page.getByLabel('Recipient email').fill(recipient.email);
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const url = await page.getByLabel('Invite link').inputValue();
  expect(url).toMatch(/#\/invite\/[a-f0-9]{64}$/);
  expect(await page.locator('.cr-brand').evaluate(element => getComputedStyle(element).fontSize)).toBe('14px');
  expect(await page.locator('.cr-brand-name').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Recipient email')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'العربية', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'دعوة عضو' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-arabic-mobile.png'), fullPage: true });

  const context = await browser.newContext();
  const guest = await context.newPage();
  try {
    await guest.goto(url);
    await expect(guest.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await guest.getByLabel('Email', { exact: true }).fill(recipient.email);
    await guest.getByLabel('Password', { exact: true }).fill(recipient.password);
    await guest.getByRole('button', { name: 'Sign in', exact: true }).click();
    await guest.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(guest.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await guest.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await expect(guest.getByText('Only the space owner can invite members.')).toBeVisible();
    await expect(guest.getByLabel('Recipient email')).toHaveCount(0);
  } finally { await context.close(); await client.auth.signOut(); }
});
