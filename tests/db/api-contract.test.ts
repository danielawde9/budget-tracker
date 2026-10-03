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
