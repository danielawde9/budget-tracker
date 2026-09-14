import { describe, expect, it } from 'vitest';
import { classifyAllocationError, isAmbiguousTransportFailure, localizeAllocationError } from './errors.js';

describe('classifyAllocationError', () => {
  it.each([
    [{ code: '42501', message: 'planning_not_authorized' }, 'missing_membership'],
    [{ code: '22023', message: 'planning_invalid_input' }, 'invalid_input'],
    [{ code: 'P0001', message: 'planning_idempotency_conflict' }, 'idempotency_conflict'],
    [{ code: '40001', message: 'planning_stale_revision' }, 'stale_revision'],
    [{ code: 'P0001', message: 'the requested snapshot does not belong to this space, currency, and month' }, 'foreign_snapshot'],
    [{ code: 'P0001', message: 'every root mapping must reference an active root expense category in this space' }, 'invalid_root_mapping'],
    [{ code: 'P0001', message: 'a submitted group id already exists with a different space, currency, or purpose' }, 'group_identity_conflict'],
    [{ code: 'P0001', message: 'the selected template does not belong to this space and currency' }, 'invalid_template'],
    [{ code: 'P0001', message: 'every template-mapped root and existing positive target must be included in a complete-set publication' }, 'incomplete_submission'],
    [{ code: 'P0001', message: 'the requested root targets exceed their spending group target' }, 'group_overallocated'],
    [{ code: 'P0001', message: 'the loan pool group must be an included Future group' }, 'invalid_loan_group'],
    [{ code: 'P0001', message: 'the observed loan commitment does not fit its linked Future group' }, 'loan_commitment_misfit'],
    [{ code: '23514', message: 'allocation_month_group_overallocated' }, 'domain_rejection'],
    [{ code: '55P03', message: 'canceling statement due to lock timeout' }, 'timeout'],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'timeout'],
    [{ message: 'AbortError: The operation was aborted' }, 'timeout'],
    [{ message: 'completely unrecognized failure' }, 'unknown'],
  ] as const)('classifies %o as %s', (cause, code) => {
    expect(classifyAllocationError(cause).code).toBe(code);
  });

  it('classifies a timeout before a stale-revision code, since the transaction outcome is unknown', () => {
    // A network abort can race with a real 40001 message string appearing in
    // logs, but the transport-level signal must win: an unknown outcome is
    // never treated as "definitely rejected, safe to resubmit blindly."
    expect(classifyAllocationError({ message: 'timeout: planning_stale_revision' }).code).toBe('timeout');
  });
});

describe('isAmbiguousTransportFailure', () => {
  it('recognizes lock/statement timeout SQLSTATEs and network-shaped messages', () => {
    expect(isAmbiguousTransportFailure({ code: '55P03', message: 'x' })).toBe(true);
    expect(isAmbiguousTransportFailure({ code: '57014', message: 'x' })).toBe(true);
    expect(isAmbiguousTransportFailure({ message: 'Failed to fetch' })).toBe(true);
    expect(isAmbiguousTransportFailure({ message: 'AbortError' })).toBe(true);
  });
  it('does not flag an ordinary domain rejection as ambiguous', () => {
    expect(isAmbiguousTransportFailure({ code: '22023', message: 'planning_invalid_input' })).toBe(false);
  });
});

describe('localizeAllocationError', () => {
  it('returns the same view for English', () => {
    const view = classifyAllocationError({ code: '40001', message: 'planning_stale_revision' });
    expect(localizeAllocationError(view, 'en')).toEqual(view);
  });
  it('substitutes Arabic copy while preserving the code', () => {
    const view = classifyAllocationError({ code: '40001', message: 'planning_stale_revision' });
    const arabic = localizeAllocationError(view, 'ar');
    expect(arabic.code).toBe('stale_revision');
    expect(arabic.message).not.toBe(view.message);
  });
});
