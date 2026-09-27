import type { WalletsGateway } from '../wallets/types.js';

/** Unlinks a settlement by reversing the wallet transaction it linked.
 * Settlement is an append-only stream and `private.schedule_occurrence_settlement`
 * nets a reversal out of the occurrence's settled total, so reversing the
 * linked event reopens the bill -- the only unlink mechanic that exists, and it
 * needs no new RPC (D7). The linked event id must come from the command that
 * made the link (its own result's `financialEventId`); the occurrence row does
 * not expose it (see `docs/verification/2026-09-27-w3a-settlement.md`). */
export async function unlinkSettlementPayment(
  wallets: Pick<WalletsGateway, 'reverseEvent'>,
  spaceId: string,
  eventId: string,
  effectiveDate: string,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
): Promise<void> {
  await wallets.reverseEvent({ spaceId, requestId: createRequestId(), eventId, effectiveDate });
}
