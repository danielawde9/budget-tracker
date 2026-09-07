import { afterAll, describe, expect, it } from 'vitest';

import { asUser, closeDatabase, grantFinancialHistoryWritesForTest } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';

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

  it('rejects changed retries and overpayment without changing posted balances', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Repayment safety', 'personal');
    const usd = await owner.createWallet(space.id, 'USD', 'USD');
    const lira = await owner.createWallet(space.id, 'LBP', 'LBP');
    const loan = await owner.openLoanOutstanding({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000006',
      direction: 'i_owe_them',
      personName: 'Salma',
      currency: 'USD',
      amountMinor: '5000',
      effectiveDate: '2026-09-03',
    });
    const first = {
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000007',
      loanId: loan.loan_id,
      walletId: usd.id,
      amountMinor: '2000',
      effectiveDate: '2026-09-03',
    };

    const accepted = await owner.repayLoan(first);
    await expect(owner.repayLoan(first)).resolves.toEqual(accepted);
    await expect(owner.repayLoan({ ...first, amountMinor: '2001' })).rejects.toMatchObject({
      code: 'P0001',
    });
    await expect(owner.repayLoan({ ...first, requestId: '20000000-0000-4000-8000-000000000008', walletId: lira.id })).rejects.toMatchObject({
      code: 'P0001',
    });
    await expect(owner.repayLoan({ ...first, requestId: '20000000-0000-4000-8000-000000000009', amountMinor: '3001' })).rejects.toMatchObject({
      code: 'P0001',
    });

    expect(await owner.loanBalance(loan.loan_id)).toEqual('3000');
    expect(await owner.walletBalance(usd.id)).toEqual('-2000');
    expect(await owner.walletBalance(lira.id)).toEqual('0');
  });

  it('serializes competing repayments so only one can consume the remaining principal', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Concurrent repayments', 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const loan = await owner.openLoanOutstanding({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000010',
      direction: 'they_owe_me',
      personName: 'Kamal',
      currency: 'USD',
      amountMinor: '100',
      effectiveDate: '2026-09-03',
    });

    const results = await Promise.allSettled([
      owner.repayLoan({
        spaceId: space.id,
        requestId: '20000000-0000-4000-8000-000000000011',
        loanId: loan.loan_id,
        walletId: wallet.id,
        amountMinor: '60',
        effectiveDate: '2026-09-03',
      }),
      owner.repayLoan({
        spaceId: space.id,
        requestId: '20000000-0000-4000-8000-000000000012',
        loanId: loan.loan_id,
        walletId: wallet.id,
        amountMinor: '60',
        effectiveDate: '2026-09-03',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await owner.loanBalance(loan.loan_id)).toEqual('40');
    expect(await owner.walletBalance(wallet.id)).toEqual('60');
  });

  it('rejects reversal of a loan origin while a dependent repayment remains', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Dependent correction', 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const loan = await owner.recordCashLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000013',
      direction: 'i_owe_them',
      personName: 'Hadi',
      currency: 'USD',
      walletId: wallet.id,
      amountMinor: '5000',
      effectiveDate: '2026-09-03',
    });
    await owner.repayLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000014',
      loanId: loan.loan_id,
      walletId: wallet.id,
      amountMinor: '2000',
      effectiveDate: '2026-09-03',
    });

    await expect(
      owner.reverseEvent(
        space.id,
        '20000000-0000-4000-8000-000000000015',
        loan.event_id,
        '2026-09-03',
      ),
    ).rejects.toMatchObject({ code: 'P0001' });

    expect(await owner.loanBalance(loan.loan_id)).toEqual('3000');
    expect(await owner.walletBalance(wallet.id)).toEqual('3000');
  });

  it('keeps a non-member out of loan commands', async () => {
    const owner = asUser(ownerId);
    const otherUser = asUser(otherUserId);
    const space = await owner.createSpace('Private loans', 'personal');

    await expect(
      otherUser.openLoanOutstanding({
        spaceId: space.id,
        requestId: '20000000-0000-4000-8000-000000000016',
        direction: 'they_owe_me',
        personName: 'Blocked',
        currency: 'USD',
        amountMinor: '1',
        effectiveDate: '2026-09-03',
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps monthly targets separate from money and counts an actual repayment once', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Monthly repayment plan', 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    const loan = await owner.openLoanOutstanding({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000017',
      direction: 'i_owe_them',
      personName: 'Maya',
      currency: 'USD',
      amountMinor: '10000',
      effectiveDate: '2026-09-01',
      dueDate: '2026-09-20',
    });

    await owner.setLoanMonthlyTarget({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000018',
      loanId: loan.loan_id,
      month: '2026-09-01',
      targetMinor: '6000',
    });

    expect(await owner.walletBalance(wallet.id)).toEqual('0');
    expect(await owner.loanBalance(loan.loan_id)).toEqual('10000');
    await expect(owner.monthlyLoanPlan(space.id, '2026-09-15')).resolves.toContainEqual(
      expect.objectContaining({
        loan_id: loan.loan_id,
        target_minor: '6000',
        actual_repayment_minor: '0',
        remaining_reservation_minor: '6000',
        due_amount_minor: '10000',
      }),
    );

    await owner.repayLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000019',
      loanId: loan.loan_id,
      walletId: wallet.id,
      amountMinor: '2000',
      effectiveDate: '2026-09-15',
    });

    await expect(owner.monthlyLoanPlan(space.id, '2026-09-15')).resolves.toContainEqual(
      expect.objectContaining({
        loan_id: loan.loan_id,
        target_minor: '6000',
        actual_repayment_minor: '2000',
        remaining_reservation_minor: '4000',
        due_amount_minor: '8000',
      }),
    );
  });

  it('summarizes due, planned, actual, and expected amounts per currency without inventing cash', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Currency summary', 'personal');
    const wallet = await owner.createWallet(space.id, 'USD', 'USD');
    await owner.openLoanOutstanding({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000020',
      direction: 'they_owe_me',
      personName: 'Expected payer',
      currency: 'USD',
      amountMinor: '4000',
      effectiveDate: '2026-09-01',
    });
    const debt = await owner.openLoanOutstanding({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000021',
      direction: 'i_owe_them',
      personName: 'Payable lender',
      currency: 'USD',
      amountMinor: '7000',
      effectiveDate: '2026-09-01',
      dueDate: '2026-09-30',
    });
    await owner.setLoanMonthlyTarget({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000022',
      loanId: debt.loan_id,
      month: '2026-09-01',
      targetMinor: '3000',
    });
    await owner.repayLoan({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000023',
      loanId: debt.loan_id,
      walletId: wallet.id,
      amountMinor: '1000',
      effectiveDate: '2026-09-15',
    });

    await expect(owner.monthlyLoanCurrencySummary(space.id, '2026-09-15')).resolves.toContainEqual(
      expect.objectContaining({
        currency: 'USD',
        owed_to_me_minor: '4000',
        i_owe_minor: '6000',
        due_amount_minor: '6000',
        planned_repayment_minor: '3000',
        actual_repayment_minor: '1000',
        remaining_reservation_minor: '2000',
        expected_collection_minor: '4000',
      }),
    );
    expect(await owner.walletBalance(wallet.id)).toEqual('-1000');
    expect(await owner.reconstructedWalletBalance(wallet.id)).toEqual('-1000');
    expect(await owner.loanBalance(debt.loan_id)).toEqual(
      await owner.reconstructedLoanBalance(debt.loan_id),
    );
  });

  it('rejects UPDATE, DELETE, and TRUNCATE even if a financial-table privilege is granted', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Immutable history', 'personal');
    const loan = await owner.openLoanOutstanding({
      spaceId: space.id,
      requestId: '20000000-0000-4000-8000-000000000024',
      direction: 'they_owe_me',
      personName: 'History',
      currency: 'USD',
      amountMinor: '100',
      effectiveDate: '2026-09-04',
    });

    await grantFinancialHistoryWritesForTest();
    await expect(owner.updatePostedEvent(loan.event_id)).rejects.toMatchObject({ code: '42501' });
    await expect(owner.deleteLoanPosting(loan.event_id)).rejects.toMatchObject({ code: '42501' });
    await expect(owner.truncateLoanPostings()).rejects.toMatchObject({ code: '42501' });
    expect(await owner.loanBalance(loan.loan_id)).toEqual('100');
  });
});
