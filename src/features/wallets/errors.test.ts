import { describe, expect, it } from 'vitest';

import { classifyWalletError, localizeWalletError } from './errors.js';

describe('wallet errors', () => {
  it.each([
    [{ code: '42501', message: 'an active space membership is required' }, 'missing_membership'],
    [{ code: 'P0001', message: 'the wallet already has this name' }, 'already_has_name'],
    [{ code: 'P0001', message: 'the wallet name must be 1 to 120 characters' }, 'invalid_name'],
    [{ code: 'P0001', message: 'the wallet is already archived' }, 'already_archived'],
    [{ code: 'P0001', message: 'the wallet is not archived' }, 'not_archived'],
    [{ code: 'P0001', message: 'the wallet is archived' }, 'wallet_archived'],
    [{ code: 'P0001', message: 'the wallet balance must be zero to archive' }, 'non_zero_balance'],
    [{ code: 'P0001', message: 'request ID was already used with different data' }, 'request_collision'],
  ] as const)('maps %s to %s without exposing database internals', (cause, code) => {
    const result = classifyWalletError(cause);
    expect(result.code).toBe(code);
    expect(result.message).not.toMatch(/wallet_command_requests|fingerprint|constraint/i);
    expect(result.recovery.length).toBeGreaterThan(0);
  });

  it('fails closed with safe copy for an unknown rejection', () => {
    expect(classifyWalletError(new Error('wallet_command_requests_wallet_fkey violated'))).toEqual({
      code: 'unknown',
      message: 'This wallet request was not accepted.',
      recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
    });
  });

  it.each([
    'missing_membership',
    'already_has_name',
    'invalid_name',
    'wallet_archived',
    'already_archived',
    'not_archived',
    'non_zero_balance',
    'request_collision',
    'unknown',
  ] as const)('localizes %s without reusing English fallback copy', (code) => {
    const result = localizeWalletError({ code, message: 'English message', recovery: 'English recovery' }, 'ar');
    expect(result.code).toBe(code);
    expect(result.message).toMatch(/[؀-ۿ]/);
    expect(result.recovery).toMatch(/[؀-ۿ]/);
    expect(`${result.message} ${result.recovery}`).not.toContain('English');
  });
});
