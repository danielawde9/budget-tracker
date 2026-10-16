import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';
import { formatMoney } from '../src/lib/money.ts';
import { runExistingMoneyStory, type ScenarioCaller } from '../scripts/preview/scenario.ts';

function demoEnv(): { url: string; anonKey: string } {
  const text = readFileSync('.env.demo.local', 'utf8');
  const value = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
  const url = value('VITE_SUPABASE_URL');
  const anonKey = value('VITE_SUPABASE_ANON_KEY');
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('The e2e tests only run against the local preview stack.');
  return { url, anonKey };
}

export async function localStackUp(): Promise<boolean> {
  try {
    const { url } = demoEnv();
    const response = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(3000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

export interface TestUser {
  readonly email: string;
  readonly password: string;
}

/** A throwaway user (local Auth has e-mail confirmation off). */
export function newUser(): TestUser {
  return { email: `e2e-${randomUUID().slice(0, 8)}@demo.budget.test`, password: `e2e-${randomUUID()}` };
}

/** A throwaway user whose space already holds the spec's two-month story. */
export async function storyUser(): Promise<TestUser> {
  const user = newUser();
  const { url, anonKey } = demoEnv();
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signUp = await client.auth.signUp(user);
  if (signUp.error || !signUp.data.session) throw new Error(`Sign-up failed: ${signUp.error?.message ?? 'no session'}`);
  const caller: ScenarioCaller = {
    async call<T>(rpc: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await client.rpc(rpc, args);
      if (error) throw new Error(`${rpc}: ${error.message}`);
      return data as T;
    },
  };
  await runExistingMoneyStory(caller, 'Household');
  return user;
}

export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Wait for the stored session before callers reload or navigate immediately.
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1, exact: true })).toHaveCount(0);
}

export async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).first().click();
}

/** Home intentionally omits the assignment equation. Verify the underlying
 * authenticated read while asserting the redesigned monthly view loads. */
export async function expectMoneyState(page: Page, cash: string, setAside: string, ready: string, summaryName = 'Monthly expenses'): Promise<void> {
  const read = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/space_overview') && response.ok());
  await page.reload();
  const data = await (await read).json() as { currencies: { currency: string; cashHeld: string; setAside: string; ready: string }[] };
  const usd = data.currencies.find(view => view.currency === 'USD')!;
  expect(formatMoney(BigInt(usd.cashHeld), 'USD', 'en')).toBe(cash);
  expect(formatMoney(BigInt(usd.setAside), 'USD', 'en')).toBe(setAside);
  expect(formatMoney(BigInt(usd.ready), 'USD', 'en')).toBe(ready);
  await expect(page.getByRole('region', { name: summaryName })).toBeVisible();
}
