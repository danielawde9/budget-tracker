import { describe, expect, it, vi } from 'vitest';

import type { ReverseEventInput, WalletsGateway } from '../wallets/types.js';
import { unlinkSettlementPayment } from './unlink-settlement.js';

describe('unlinkSettlementPayment (D7)', () => {
  it('reverses the linked wallet transaction with a fresh request id', async () => {
    const reverseEvent = vi.fn(async (_input: ReverseEventInput) => ({ eventId: 'reversal-1' }));
    const wallets = { reverseEvent } as unknown as Pick<WalletsGateway, 'reverseEvent'>;
    await unlinkSettlementPayment(wallets, 'space-1', 'event-9', '2026-09-27', () => 'req-1');
    expect(reverseEvent).toHaveBeenCalledWith({
      spaceId: 'space-1', requestId: 'req-1', eventId: 'event-9', effectiveDate: '2026-09-27',
    });
  });
});
