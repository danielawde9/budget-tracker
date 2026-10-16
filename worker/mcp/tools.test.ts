import { expect, it } from 'vitest';
import { entryInput } from './tools.ts';

const entry = { requestId: '459d692d-4ab6-45ca-8d9c-7b189005e35d', kind: 'income', walletId: '559d692d-4ab6-45ca-8d9c-7b189005e35d', currency: 'USD', amountMinor: '2000', on: '2026-10-16' };
it('accepts a ledger-sized memo and rejects one the database cannot save', () => {
  expect(entryInput.parse({ ...entry, memo: 'a'.repeat(200) }).memo).toHaveLength(200);
  expect(entryInput.safeParse({ ...entry, memo: 'a'.repeat(201) }).success).toBe(false);
});
it('accepts exact integer money and real dates, rejecting ambiguous or oversized input', () => {
  expect(entryInput.parse(entry).amountMinor).toBe('2000');
  for (const bad of [{ amountMinor: '20.00' }, { amountMinor: 2000 }, { amountMinor: '-1' }, { amountMinor: '0' }, { amountMinor: '1000000000000001' }, { on: '2026-02-30' }, { memo: 'a'.repeat(501) }, { spaceId: 'injected' }, { kind: 'transfer' }, { kind: 'expense' }]) {
    expect(entryInput.safeParse({ ...entry, ...bad }).success).toBe(false);
  }
});
