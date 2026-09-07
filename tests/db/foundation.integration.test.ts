import { afterAll, describe, expect, it } from 'vitest';

import { asUser, closeDatabase } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';

afterAll(async () => {
  await closeDatabase();
});

describe('financial journal foundation', () => {
  it('creates an owner-managed private space', async () => {
    const owner = asUser(ownerId);

    await expect(owner.createSpace('Daniel private', 'personal')).resolves.toMatchObject({
      id: expect.any(String),
    });
  });

  it('includes opening cash in a wallet balance without treating it as income', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Opening-balance space', 'personal');
    const wallet = await owner.createWallet(space.id, 'Pocket USD', 'USD');

    await owner.recordEvent({
      spaceId: space.id,
      requestId: '10000000-0000-4000-8000-000000000001',
      kind: 'opening_balance',
      effectiveDate: '2026-09-01',
      movements: [{ walletId: wallet.id, amountMinor: '230000' }],
    });

    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('230000');
    await expect(owner.incomeEventCount(space.id)).resolves.toEqual(0);
  });

  it('preserves a posted event and creates a linked reversal', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Correction space', 'personal');
    const wallet = await owner.createWallet(space.id, 'Pocket USD', 'USD');
    const income = await owner.recordEvent({
      spaceId: space.id,
      requestId: '10000000-0000-4000-8000-000000000002',
      kind: 'income',
      effectiveDate: '2026-09-01',
      movements: [{ walletId: wallet.id, amountMinor: '10000' }],
    });

    const reversal = await owner.reverseEvent(
      space.id,
      '10000000-0000-4000-8000-000000000003',
      income.id,
      '2026-09-02',
    );

    expect(reversal.id).not.toEqual(income.id);
    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('0');
    await expect(owner.incomeEventCount(space.id)).resolves.toEqual(1);
  });
});
