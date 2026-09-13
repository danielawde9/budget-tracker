import { useCallback, useRef, useState } from 'react';
import type { ExchangeClient } from './types.js';

const defaultCreateRequestId = () => crypto.randomUUID();

export interface ExchangeDraft {
  usdWalletId: string;
  lbpWalletId: string;
  usdAmountMinor: string;
  lbpAmountMinor: string;
  effectiveDate: string;
}

export type ExchangeOutcome = { status: 'success' | 'ambiguous'; reconciled: boolean };

interface ExchangeReceipts {
  findEventByRequestId(spaceId: string, requestId: string): Promise<unknown | null>;
}

interface AmbiguousExchange {
  requestId: string;
  draft: ExchangeDraft;
}

export interface ExchangeState {
  pending: boolean;
  ambiguous: { requestId: string } | null;
  recordExchange(draft: ExchangeDraft): Promise<ExchangeOutcome>;
  retryAmbiguous(): Promise<ExchangeOutcome>;
  clearAmbiguous(): void;
}

function isAmbiguousTransportFailure(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /network|failed to fetch|load failed|connection|timeout/i.test(message);
}

export function useExchange(
  client: ExchangeClient,
  receipts: ExchangeReceipts,
  spaceId: string,
  onRecorded: () => Promise<void> | void,
  createRequestId: () => string = defaultCreateRequestId,
): ExchangeState {
  const [pending, setPending] = useState(false);
  const [ambiguous, setAmbiguous] = useState<AmbiguousExchange | null>(null);
  const pendingCommand = useRef<Promise<ExchangeOutcome> | null>(null);

  const run = useCallback(async (
    requestId: string,
    draft: ExchangeDraft,
  ): Promise<ExchangeOutcome> => {
    let reconciled = false;
    try {
      await client.recordExchange({ spaceId, requestId, ...draft });
    } catch (cause) {
      if (!isAmbiguousTransportFailure(cause)) throw cause;
      let event: unknown | null;
      try {
        event = await receipts.findEventByRequestId(spaceId, requestId);
      } catch (reconciliationCause) {
        setAmbiguous({ requestId, draft });
        throw reconciliationCause;
      }
      if (!event) {
        setAmbiguous({ requestId, draft });
        return { status: 'ambiguous', reconciled: false };
      }
      reconciled = true;
    }
    await onRecorded();
    setAmbiguous(null);
    return { status: 'success', reconciled };
  }, [client, receipts, spaceId, onRecorded]);

  const recordExchange = useCallback(async (draft: ExchangeDraft): Promise<ExchangeOutcome> => {
    if (pendingCommand.current) throw new Error('An exchange is already pending.');
    const requestId = createRequestId();
    setAmbiguous(null);
    setPending(true);
    const command = run(requestId, draft);
    pendingCommand.current = command;
    try {
      return await command;
    } finally {
      pendingCommand.current = null;
      setPending(false);
    }
  }, [createRequestId, run]);

  const retryAmbiguous = useCallback(async (): Promise<ExchangeOutcome> => {
    if (pendingCommand.current) throw new Error('An exchange is already pending.');
    const attempt = ambiguous;
    if (!attempt) throw new Error('There is no ambiguous exchange to retry.');
    setPending(true);
    const command = run(attempt.requestId, attempt.draft);
    pendingCommand.current = command;
    try {
      return await command;
    } finally {
      pendingCommand.current = null;
      setPending(false);
    }
  }, [ambiguous, run]);

  const clearAmbiguous = useCallback(() => setAmbiguous(null), []);

  return {
    pending,
    ambiguous: ambiguous ? { requestId: ambiguous.requestId } : null,
    recordExchange,
    retryAmbiguous,
    clearAmbiguous,
  };
}
