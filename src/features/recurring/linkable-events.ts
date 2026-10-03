import type { Currency } from '../loans/types.js';
import type { JournalEvent, JournalEventKind, WalletsGateway } from '../wallets/types.js';
import type { ScheduleKind } from './types.js';

/** One wallet event a settlement dialog may offer for linking -- the read-only
 * projection the picker renders (D4). `amountMinor` is the event's eligible
 * amount (positive, in its own currency), the same figure
 * `link_scheduled_payment` caps a link against. */
export interface LinkableEventOption {
  readonly id: string;
  readonly kind: JournalEventKind;
  readonly effectiveDate: string;
  readonly amountMinor: string;
  readonly currency: Currency;
  readonly label: string;
}

export interface LinkableEventsQuery {
  readonly kind: ScheduleKind;
  readonly currency: Currency;
}

/** How many recent events the picker loads in one read. */
export const LINKABLE_EVENT_LIMIT = 50;

/** The wallet event kind that can settle each occurrence kind: an expense bill
 * is settled by an `expense`, an income bill by `income`, and a debt-payment
 * occurrence by the loan repayment the person recorded
 * (`loan_repay_borrowing`; the server additionally checks the loan). */
export function linkableEventKind(kind: ScheduleKind): JournalEventKind {
  if (kind === 'income') return 'income';
  if (kind === 'debt_payment') return 'loan_repay_borrowing';
  return 'expense';
}

/** The event's eligible amount in `currency`, or null when it is not a plain,
 * single-currency, positive event of that kind (it cannot be linked:
 * `link_scheduled_payment` rejects a reversal, a reversed event, and a
 * multi-currency event). */
function eligibleAmountMinor(event: JournalEvent, currency: Currency): string | null {
  if (event.reversedBy !== null || event.reversalOf !== null) return null;
  const movements = event.movements.filter((movement) => movement.currency === currency);
  if (movements.length === 0 || movements.length !== event.movements.length) return null;
  const total = movements.reduce((sum, movement) => sum + BigInt(movement.amountMinor), 0n);
  const magnitude = total < 0n ? -total : total;
  return magnitude === 0n ? null : magnitude.toString();
}

function labelFor(event: JournalEvent): string {
  return event.payeeName ?? event.note ?? event.movements[0]?.walletName ?? event.kind;
}

/**
 * Loads the wallet events a person can pick to settle one occurrence,
 * read-only through the existing wallets gateway (`searchJournal`), so the
 * manual "Link an existing transaction" path has a real picker instead of a
 * pasted id no screen shows (`audit` D4). The caller passes the occurrence's
 * kind and currency; only a same-kind, single-currency, positive, unreversed
 * event of the matching wallet kind is offered. The server still validates the
 * link itself.
 */
export async function loadLinkableEvents(
  wallets: Pick<WalletsGateway, 'searchJournal'>,
  spaceId: string,
  query: LinkableEventsQuery,
): Promise<readonly LinkableEventOption[]> {
  const wanted = linkableEventKind(query.kind);
  const options: LinkableEventOption[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await wallets.searchJournal(spaceId, { limit: LINKABLE_EVENT_LIMIT, ...(cursor ? { cursor } : {}) });
    for (const event of page.events) {
      if (event.kind !== wanted) continue;
      const amountMinor = eligibleAmountMinor(event, query.currency);
      if (amountMinor === null) continue;
      options.push({
        id: event.id,
        kind: event.kind,
        effectiveDate: event.effectiveDate,
        amountMinor,
        currency: query.currency,
        label: labelFor(event),
      });
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor)) throw new Error('Journal cursor did not advance.');
      seen.add(cursor);
    }
  } while (cursor);
  return options;
}
