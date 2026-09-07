import { afterAll, describe, expect, it } from 'vitest';

import { asUser, closeDatabase } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';

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

  it('denies another user a wallet command in a private space', async () => {
    const owner = asUser(ownerId);
    const otherUser = asUser(otherUserId);
    const space = await owner.createSpace('Private command space', 'personal');

    await expect(otherUser.createWallet(space.id, 'Blocked wallet', 'USD')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('returns the original event for an identical request replay', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Replay space', 'personal');
    const wallet = await owner.createWallet(space.id, 'Pocket USD', 'USD');
    const input = {
      spaceId: space.id,
      requestId: '10000000-0000-4000-8000-000000000004',
      kind: 'income' as const,
      effectiveDate: '2026-09-01',
      movements: [{ walletId: wallet.id, amountMinor: '10000' }],
    };

    const first = await owner.recordEvent(input);
    const replay = await owner.recordEvent(input);

    expect(replay.id).toEqual(first.id);
    await expect(owner.walletBalance(wallet.id)).resolves.toEqual('10000');
  });

  it('rejects an unbalanced transfer without changing either wallet', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Atomic transfer space', 'personal');
    const source = await owner.createWallet(space.id, 'Source USD', 'USD');
    const destination = await owner.createWallet(space.id, 'Destination USD', 'USD');

    await expect(
      owner.recordEvent({
        spaceId: space.id,
        requestId: '10000000-0000-4000-8000-000000000005',
        kind: 'transfer',
        effectiveDate: '2026-09-01',
        movements: [
          { walletId: source.id, amountMinor: '-10000' },
          { walletId: destination.id, amountMinor: '9999' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'P0001' });

    await expect(owner.walletBalance(source.id)).resolves.toEqual('0');
    await expect(owner.walletBalance(destination.id)).resolves.toEqual('0');
  });
});
