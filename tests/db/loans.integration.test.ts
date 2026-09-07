import { afterAll, describe, expect, it } from 'vitest';

import { asUser, closeDatabase } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';

afterAll(async () => {
  await closeDatabase();
});

describe('loans ledger', () => {
  it('records an opening borrowing without creating wallet cash', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Opening borrowing', 'personal');
    const wallet = await owner.createWallet(space.id, 'Cash USD', 'USD');

    await expect(
      owner.openLoanOutstanding({
        spaceId: space.id,
        requestId: '20000000-0000-4000-8000-000000000001',
        direction: 'i_owe_them',
        personName: 'Amina',
        currency: 'USD',
        amountMinor: '12500',
        effectiveDate: '2026-09-01',
      }),
    ).resolves.toMatchObject({
      loan_id: expect.any(String),
      event_id: expect.any(String),
    });

    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('0');
  });
});
