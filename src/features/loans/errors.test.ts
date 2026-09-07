import { describe, expect, it } from 'vitest';
import { classifyLoanError } from './errors.js';

describe('classifyLoanError', () => {
  it.each([
    ['the wallet must be active, in the requested space, and in the loan currency', 'wrong_currency'],
    ['the repayment exceeds the outstanding principal', 'overpayment'],
    ['request ID was already used with different data', 'retry_collision'],
    ['an active space membership is required', 'missing_membership'],
    ['the correction would invalidate dependent repayments', 'dependent_repayment'],
  ] as const)('classifies %s as %s', (message, code) => {
    expect(classifyLoanError({ message })).toMatchObject({ code });
  });

  it('explains the dependent-repayment recovery order', () => {
    expect(classifyLoanError({ message: 'the correction would invalidate dependent repayments' }).recovery).toBe(
      'Reverse the later repayments first, then retry this correction.',
    );
  });

  it('keeps a safe unknown database rejection visible', () => {
    expect(classifyLoanError({ message: 'The database rejected this effective date.' })).toEqual({
      code: 'database_rejection',
      title: 'The change was not recorded',
      message: 'The database rejected this effective date.',
      recovery: 'Review the details, refresh the ledger, and try again.',
    });
  });

  it('does not expose non-message values', () => {
    expect(classifyLoanError({ token: 'secret' })).toMatchObject({
      code: 'database_rejection',
      message: 'The database rejected this request.',
    });
  });
});
