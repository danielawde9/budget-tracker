import { isAmbiguousTransportFailure } from './errors.js';
import type { LinkExistingInput, LinkExistingResult, RecurringGateway } from './types.js';

/** Links one settlement, retrying **once** when the first attempt fails with an
 * ambiguous transport failure (a timeout or connection drop -- what
 * `planningRpc`'s 15s abort produces, D7). The settlement command is
 * idempotent under its request id, so the retry reuses the SAME request id and
 * can never double-post money; before retrying it first reconciles with
 * `findCommand`, so a request that actually landed before its response was
 * lost is reported as the success it was rather than being sent again.
 *
 * Only one retry happens (a fixed bound, global engineering rule #2): a second
 * ambiguous failure is rethrown so the caller reports `failed`/`partial`
 * instead of looping. A non-transport failure (a domain rejection, a stale
 * revision) is never retried -- the same request would be refused again. */
export async function linkScheduledPaymentWithRetry(
  gateway: RecurringGateway,
  input: LinkExistingInput,
): Promise<LinkExistingResult> {
  try {
    return await gateway.linkExisting(input);
  } catch (cause) {
    if (!isAmbiguousTransportFailure(cause)) throw cause;
    // A lost response is not a lost command: if the request id already has a
    // receipt, the link went through and only the reply was dropped.
    let receipt = null;
    try {
      receipt = await gateway.findCommand(input.spaceId, input.requestId);
    } catch {
      receipt = null;
    }
    if (receipt && receipt.command === 'link_scheduled_payment') {
      return receipt.result as LinkExistingResult;
    }
    // No receipt: the command likely never ran, so retry it once unchanged.
    return gateway.linkExisting(input);
  }
}
