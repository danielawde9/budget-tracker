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

  it('posts lending, borrowing, and partial repayments with their linked wallet effects', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Cash loan flows', 'personal');
    const wallet = await owner.createWallet(space.id, 'Cash USD', 'USD');

    const lent = await owner.recordCashLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000002',
      direction: 'they_owe_me',
      personName: 'Nour',
      currency: 'USD',
      walletId: wallet.id,
      amountMinor: '5000',
      effectiveDate: '2026-09-02',
    });

    expect(await owner.walletBalance(wallet.id)).toEqual('-5000');
    expect(await owner.loanBalance(lent.loan_id)).toEqual('5000');

    const borrowed = await owner.recordCashLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000003',
      direction: 'i_owe_them',
      personName: 'Rami',
      currency: 'USD',
      walletId: wallet.id,
      amountMinor: '7000',
      effectiveDate: '2026-09-02',
    });

    expect(await owner.walletBalance(wallet.id)).toEqual('2000');
    expect(await owner.loanBalance(borrowed.loan_id)).toEqual('7000');

    await owner.repayLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000004',
      loanId: lent.loan_id,
      walletId: wallet.id,
      amountMinor: '2000',
      effectiveDate: '2026-09-03',
    });
    await owner.repayLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000005',
      loanId: borrowed.loan_id,
      walletId: wallet.id,
      amountMinor: '3000',
      effectiveDate: '2026-09-03',
    });

    expect(await owner.walletBalance(wallet.id)).toEqual('1000');
    expect(await owner.loanBalance(lent.loan_id)).toEqual('3000');
    expect(await owner.loanBalance(borrowed.loan_id)).toEqual('4000');
  });
});
