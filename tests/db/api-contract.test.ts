import { randomUUID } from 'node:crypto';
import { setupSpace } from './support/budget.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/api/schemas.ts';
import { runExistingMoneyStory, type ScenarioCaller, type StoryRefs } from '../../scripts/preview/scenario.ts';
import { callAs, createUser } from './support/actor.ts';
import { freshDatabase, type TestDatabase } from './support/database.ts';

// The browser validates every read with zod. These tests feed the real
// database output (after the full demonstration story) through those same
// schemas, so a renamed or retyped field fails here, not in the preview.

let db: TestDatabase;
let c: ScenarioCaller;
let story: StoryRefs;

beforeAll(async () => {
  db = await freshDatabase();
  const userId = await createUser(db.pool);
  c = { call: (rpc, args) => callAs(db.pool, userId, rpc, args) };
  story = await runExistingMoneyStory(c);
});

afterAll(async () => {
  await db.close();
});

describe('every read matches the client schema', () => {
  it('my_spaces', async () => {
    expect(s.spaceSummary.array().safeParse(await c.call('my_spaces', {})).success).toBe(true);
  });

  it('space_overview', async () => {
    const parsed = s.overview.safeParse(await c.call('space_overview', { p_space: story.spaceId }));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('plan_month for the setup, current and next month', async () => {
    for (const month of [story.setupMonth, story.currentMonth, '2099-01-01']) {
      const parsed = s.planMonth.safeParse(await c.call('plan_month', { p_space: story.spaceId, p_month: month }));
      expect(parsed.error?.issues ?? [], month).toEqual([]);
    }
  });

  it('funding_preview', async () => {
    const parsed = s.fundingPreview.safeParse(await c.call('funding_preview', { p_space: story.spaceId, p_month: story.currentMonth, p_currency: null, p_amount: null }));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('item_statement', async () => {
    const parsed = s.itemStatement.safeParse(await c.call('item_statement', { p_space: story.spaceId, p_item: story.items['Groceries'], p_month: story.setupMonth }));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('activity_page (every entry kind in the story)', async () => {
    const parsed = s.activityPage.safeParse(await c.call('activity_page', { p_space: story.spaceId, p_limit: 100, p_before: null, p_filter: {} }));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('accounts_overview, bills_upcoming and bills_list', async () => {
    expect(s.accounts.safeParse(await c.call('accounts_overview', { p_space: story.spaceId })).error?.issues ?? []).toEqual([]);
    expect(s.billOccurrence.array().safeParse(await c.call('bills_upcoming', { p_space: story.spaceId, p_from: story.setupMonth, p_to: story.today })).error?.issues ?? []).toEqual([]);
    expect(s.bill.array().safeParse(await c.call('bills_list', { p_space: story.spaceId })).error?.issues ?? []).toEqual([]);
  });
});

// Check the correction command's actual receipt and the updated activity fields.
it('move_bill_payment matches the client result schema and activity link history', async () => {
  const h = await setupSpace(db.pool);
  const wallet = await h.wallet('Bank', 'cash', 'USD', 10000n);
  const item = await h.item('Bills');
  const bill = (await h.command<{ billId: string }>('save_bill', { p_name: 'Water', p_item: item, p_amount: 6000n, p_currency: 'USD', p_cadence: 'once', p_first_due: h.today })).billId;
  await h.command('assign_money', { p_on: h.today, p_moves: [{ from: null, to: item, currency: 'USD', amountMinor: '6000' }] });
  const entry = await h.command('record_expense', { p_wallet: wallet, p_item: item, p_amount: 2000n, p_on: h.today, p_cover_from: null });
  const result = await h.command('move_bill_payment', { p_entry: entry.entryId, p_expected_version: 0, p_bill: bill, p_due: h.today, p_request: randomUUID() });
  expect(s.billLinkResult.safeParse(result).error?.issues ?? []).toEqual([]);
  const activity = await h.call('activity_page', { p_space: h.spaceId, p_limit: 100, p_before: null, p_filter: {} });
  expect(s.activityPage.safeParse(activity).error?.issues ?? []).toEqual([]);
});
