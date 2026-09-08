import { describe, expect, it } from 'vitest';

import { classifyCategoryError, isAmbiguousTransportFailure } from './errors.js';

describe('category errors', () => {
  it('classifies only transport failures as ambiguous', () => {
    expect(isAmbiguousTransportFailure(new Error('Failed to fetch'))).toBe(true);
    expect(isAmbiguousTransportFailure({ message: 'Connection timeout' })).toBe(true);
    expect(isAmbiguousTransportFailure({ code: 'P0001', message: 'request ID was already used with different data' })).toBe(false);
  });

  it.each([
    [{ code: '42501', message: 'an active space membership is required' }, 'missing_membership'],
    [{ code: 'P0001', message: 'an active category already uses one of the supplied normalized names' }, 'duplicate_name'],
    [{ code: 'P0001', message: 'the category must be active, in the requested space, and match the event kind' }, 'invalid_category'],
    [{ code: 'P0001', message: 'request ID was already used with different data' }, 'request_collision'],
    [{ code: 'P0001', message: 'the category is already archived' }, 'already_archived'],
  ] as const)('maps %s to %s without exposing database internals', (cause, code) => {
    const result = classifyCategoryError(cause);
    expect(result.code).toBe(code);
    expect(result.message).not.toMatch(/categories_active_name|fingerprint|constraint/i);
    expect(result.recovery.length).toBeGreaterThan(0);
  });

  it('fails closed with safe copy for an unknown rejection', () => {
    expect(classifyCategoryError(new Error('index categories_active_name_en_idx leaked'))).toEqual({
      code: 'unknown',
      message: 'The category request was not accepted.',
      recovery: 'Check the details and try again. If the problem continues, refresh the selected space.',
    });
  });
});
