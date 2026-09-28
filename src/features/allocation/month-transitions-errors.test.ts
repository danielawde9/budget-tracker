import { describe, expect, it } from 'vitest';
import { classifyAllocationError, localizeAllocationError } from './errors.js';
import { postgrestRejection } from '../../test/postgrest-rejection.js';

describe('classifyAllocationError: month transitions', () => {
  it('classifies the source-not-found rejection', () => {
    expect(classifyAllocationError(postgrestRejection('P0001', 'month_copy_source_not_found')).code).toBe('copy_source_not_found');
  });

  it('classifies a month that has not ended before its broad 22023 invalid-input branch', () => {
    expect(classifyAllocationError(postgrestRejection('22023', 'budget_month_not_ended')).code).toBe('month_not_ended');
  });

  it('classifies a close with no published plan', () => {
    expect(classifyAllocationError(postgrestRejection('P0001', 'budget_month_close_requires_plan')).code).toBe('close_requires_plan');
  });

  it('classifies an over-cap fact range', () => {
    expect(classifyAllocationError(postgrestRejection('54000', 'range_too_large')).code).toBe('range_too_large');
  });

  it('classifies the rollover policy rejections', () => {
    expect(classifyAllocationError(postgrestRejection('P0001', 'rollover_policy_requires_expense_root')).code).toBe('rollover_requires_expense_root');
    expect(classifyAllocationError(postgrestRejection('P0001', 'rollover_policy_archived_root')).code).toBe('rollover_archived_root');
  });

  it('keeps a stale preview hash as the existing stale_revision view', () => {
    expect(classifyAllocationError(postgrestRejection('40001', 'planning_stale_revision')).code).toBe('stale_revision');
  });

  it('localizes the new codes into Arabic, not English', () => {
    const arabic = localizeAllocationError(classifyAllocationError(postgrestRejection('22023', 'budget_month_not_ended')), 'ar');
    expect(arabic.message).not.toMatch(/[A-Za-z]{4,}/);
    expect(arabic.code).toBe('month_not_ended');
  });
});
