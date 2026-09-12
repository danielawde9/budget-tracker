import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { asUser, closeDatabase, databaseQuery, queryAsRole, queryAsUser } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';

afterAll(async () => {
  await closeDatabase();
});

describe('financial event descriptions', () => {
  it('attaches one immutable normalized payee and note beside an existing event', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Descriptions ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'Cash', 'USD');
    const event = await owner.recordEvent({
      spaceId: space.id,
      requestId: randomUUID(),
      kind: 'expense',
      effectiveDate: '2026-09-12',
      movements: [{ walletId: wallet.id, amountMinor: '-1250' }],
    });
    const requestId = randomUUID();

    await expect(queryAsUser(ownerId,
      'select * from public.describe_financial_event($1, $2, $3, $4, $5)',
      [space.id, requestId, event.id, '  Ｃｅｄａｒ   Market  ', '  groceries for the week  '],
    )).resolves.toEqual([{ id: event.id }]);

    await expect(queryAsUser(ownerId,
      `select payee.name, payee.name_key, description.note
       from public.financial_event_descriptions as description
       left join public.payees as payee on payee.id = description.payee_id
       where description.event_id = $1`,
      [event.id],
    )).resolves.toEqual([{
      name: 'Cedar Market',
      name_key: 'cedar market',
      note: 'groceries for the week',
    }]);

    await expect(queryAsUser(ownerId,
      'select * from public.describe_financial_event($1, $2, $3, $4, $5)',
      [space.id, requestId, event.id, 'Cedar Market', 'groceries for the week'],
    )).resolves.toEqual([{ id: event.id }]);
  });

  it('fails closed for direct metadata writes and cannot overwrite an event description', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace(`Description guards ${randomUUID()}`, 'personal');
    const wallet = await owner.createWallet(space.id, 'Cash', 'USD');
    const event = await owner.recordEvent({
      spaceId: space.id, requestId: randomUUID(), kind: 'expense', effectiveDate: '2026-09-12',
      movements: [{ walletId: wallet.id, amountMinor: '-500' }],
    });
    await queryAsUser(ownerId, 'select * from public.describe_financial_event($1, $2, $3, $4, $5)', [space.id, randomUUID(), event.id, null, 'first note']);

    await expect(queryAsUser(ownerId,
      'insert into public.financial_event_descriptions (event_id, space_id, note, created_by) values ($1, $2, $3, $4)',
      [event.id, space.id, 'bypass', ownerId],
    )).rejects.toMatchObject({ code: '42501' });
    await expect(queryAsUser(ownerId,
      'select * from public.describe_financial_event($1, $2, $3, $4, $5)',
      [space.id, randomUUID(), event.id, 'Cedar Market', 'replacement'],
    )).rejects.toMatchObject({ code: 'P0001', message: 'the event already has immutable descriptive metadata' });
    await expect(queryAsRole('service_role',
      'select * from public.describe_financial_event($1, $2, $3, $4, $5)',
      [space.id, randomUUID(), event.id, null, 'background bypass'],
    )).rejects.toMatchObject({ code: '42501' });
    await expect(databaseQuery<{ writable: boolean }>(
      `select has_table_privilege('authenticated', 'public.financial_event_descriptions', 'insert') as writable`,
    )).resolves.toEqual([{ writable: false }]);
  });
});
