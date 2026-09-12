import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { asUser, closeDatabase, databaseQuery, queryAsUser } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';

afterAll(async () => {
  await closeDatabase();
});

describe('monthly budgeting boundary', () => {
  it('keeps planned income and expense targets separate from cash while returning left to allocate', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Monthly budget ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'Budget cash', 'USD');
    const category = await owner.createCategory({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      nameEn: 'Food',
    });

    const before = await owner.walletBalance(wallet.id);
    const income = await queryAsUser<{ id: string }>(
      ownerId,
      'select * from public.set_monthly_income_plan($1, $2, $3::date, $4::public.currency_code, $5, null)',
      [space.id, randomUUID(), '2026-09-28', 'USD', '10000'],
    );
    const target = await queryAsUser<{ id: string }>(
      ownerId,
      'select * from public.set_monthly_category_target($1, $2, $3, $4::date, $5::public.currency_code, $6, null)',
      [space.id, randomUUID(), category.id, '2026-09-28', 'USD', '3500'],
    );
    expect(await owner.walletBalance(wallet.id)).toBe(before);
    await owner.recordCategorizedEvent({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      effectiveDate: '2026-09-14',
      movements: [{ walletId: wallet.id, amountMinor: '-2500' }],
      categoryId: category.id,
    });
    await owner.recordEvent({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      effectiveDate: '2026-09-15',
      movements: [{ walletId: wallet.id, amountMinor: '-500' }],
    });

    expect(income).toHaveLength(1);
    expect(target).toHaveLength(1);
    await expect(databaseQuery(
      `insert into public.monthly_budget_plan_revisions (
         space_id, request_id, request_fingerprint, plan_kind, month_start, currency,
         category_id, category_kind, amount_minor, actor_id
       ) values ($1, $2, decode('00', 'hex'), 'expense_category', '2026-09-01', 'USD', $3, null, 1, $4)`,
      [space.id, randomUUID(), category.id, ownerId],
    )).rejects.toMatchObject({ code: '23514', constraint: 'monthly_budget_plan_revisions_shape_check' });
    await expect(queryAsUser(
      ownerId,
      `select currency::text, planned_income_minor::text, category_target_total_minor::text,
              category_actual_spent_minor::text, uncategorized_spent_minor::text, unallocated_minor::text
       from public.monthly_budget_currency_summary($1, $2::date)`,
      [space.id, '2026-09-05'],
    )).resolves.toEqual([{
      currency: 'USD', planned_income_minor: '10000', category_target_total_minor: '3500',
      category_actual_spent_minor: '2500', uncategorized_spent_minor: '500', unallocated_minor: '6500',
    }]);
    await expect(queryAsUser(
      ownerId,
      `select category_id::text, currency::text, target_minor::text, actual_spent_minor::text,
              remaining_minor::text, overspent_minor::text, target_revision_id::text
       from public.monthly_budget_category_page($1, $2::date, null, null, null, 50)`,
      [space.id, '2026-09-05'],
    )).resolves.toEqual([{
      category_id: category.id,
      currency: 'USD',
      target_minor: '3500',
      actual_spent_minor: '2500',
      remaining_minor: '1000',
      overspent_minor: '0',
      target_revision_id: target[0]?.id,
    }, {
      category_id: category.id,
      currency: 'LBP',
      target_minor: '0',
      actual_spent_minor: '0',
      remaining_minor: '0',
      overspent_minor: '0',
      target_revision_id: null,
    }]);
  });
});
