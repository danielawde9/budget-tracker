import { describe, expect, it, vi } from 'vitest';

import { postgrestRejection } from '../../test/postgrest-rejection.js';
import { linkScheduledPaymentWithRetry } from './link-with-retry.js';
import type {
  LinkExistingInput, LinkExistingResult, PlanningCommandReceipt, RecurringGateway,
} from './types.js';

const INPUT: LinkExistingInput = {
  spaceId: 'space-1', requestId: 'req-1', occurrenceId: 'occ-1', eventId: 'event-9',
  amountMinor: '4000', expectedEventId: 'evt-head-1',
};

const RESULT: LinkExistingResult = { occurrenceId: 'occ-1', occurrenceEventId: 'oe-1', financialEventId: 'event-9' };

/** The plain `{ code, message }` object the real gateway rethrows. A 57014
 * statement timeout is the ambiguous transport failure `planningRpc`'s abort
 * produces (final review I1). */
const TIMEOUT = postgrestRejection('57014', 'canceling statement due to statement timeout');
const REFUSED = postgrestRejection('P0001', 'a payment cannot be linked before its effective date has occurred');

function fakeGateway(link: (input: LinkExistingInput) => Promise<LinkExistingResult>, receipt: PlanningCommandReceipt | null = null) {
  const gateway: Pick<RecurringGateway, 'linkExisting' | 'findCommand'> = {
    linkExisting: vi.fn(link),
    findCommand: vi.fn(async () => receipt),
  };
  return { gateway: gateway as RecurringGateway, link: gateway.linkExisting as ReturnType<typeof vi.fn> };
}

describe('linkScheduledPaymentWithRetry (D7)', () => {
  it('returns the link result directly on success, with no retry and no receipt lookup', async () => {
    const { gateway, link } = fakeGateway(async () => RESULT);
    await expect(linkScheduledPaymentWithRetry(gateway, INPUT)).resolves.toEqual(RESULT);
    expect(link).toHaveBeenCalledOnce();
    expect(gateway.findCommand).not.toHaveBeenCalled();
  });

  it('retries the same request id once after a timeout with no receipt, and returns the retry', async () => {
    const link = vi.fn()
      .mockRejectedValueOnce(TIMEOUT)
      .mockResolvedValueOnce(RESULT);
    const gateway = { linkExisting: link, findCommand: vi.fn(async () => null) } as unknown as RecurringGateway;
    await expect(linkScheduledPaymentWithRetry(gateway, INPUT)).resolves.toEqual(RESULT);
    expect(link).toHaveBeenCalledTimes(2);
    // The SAME request id both times: a retry can never double-post.
    expect(link.mock.calls[0]?.[0]?.requestId).toBe('req-1');
    expect(link.mock.calls[1]?.[0]?.requestId).toBe('req-1');
  });

  it('reconciles an already-landed request through the receipt instead of retrying', async () => {
    const receipt: PlanningCommandReceipt = { command: 'link_scheduled_payment', sequenceId: '7', result: RESULT };
    const { gateway, link } = fakeGateway(async () => { throw TIMEOUT; }, receipt);
    await expect(linkScheduledPaymentWithRetry(gateway, INPUT)).resolves.toEqual(RESULT);
    expect(link).toHaveBeenCalledOnce();
    expect(gateway.findCommand).toHaveBeenCalledWith('space-1', 'req-1');
  });

  it('never retries a domain rejection', async () => {
    const { gateway, link } = fakeGateway(async () => { throw REFUSED; });
    await expect(linkScheduledPaymentWithRetry(gateway, INPUT)).rejects.toBe(REFUSED);
    expect(link).toHaveBeenCalledOnce();
    expect(gateway.findCommand).not.toHaveBeenCalled();
  });

  it('is bounded to one retry: a second timeout is rethrown', async () => {
    const { gateway, link } = fakeGateway(async () => { throw TIMEOUT; });
    await expect(linkScheduledPaymentWithRetry(gateway, INPUT)).rejects.toBe(TIMEOUT);
    expect(link).toHaveBeenCalledTimes(2);
  });
});
