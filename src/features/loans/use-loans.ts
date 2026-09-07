import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyLoanError } from './errors.js';
import type {
  CreateLoanInput,
  LoanErrorView,
  LoansDashboard,
  LoansGateway,
  MonthlyTargetInput,
  RepaymentInput,
  ReversalInput,
  Space,
} from './types.js';

type CreateDraft = Omit<CreateLoanInput, 'requestId'>;
type RepaymentDraft = Omit<RepaymentInput, 'requestId'>;
type TargetDraft = Omit<MonthlyTargetInput, 'requestId'>;
type ReversalDraft = Omit<ReversalInput, 'requestId'>;

function currentMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

export interface UseLoansOptions {
  spaceId?: string;
  onSpaceUnavailable?(): void;
}

export function useLoans(gateway: LoansGateway, options?: UseLoansOptions) {
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [internalSpaceId, setSpaceIdState] = useState('');
  const [month, setMonthState] = useState(currentMonth());
  const [dashboard, setDashboard] = useState<LoansDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoanErrorView | null>(null);
  const requests = useRef(new Map<string, { fingerprint: string; id: string }>());
  const loadSequence = useRef(0);
  const controlled = options?.spaceId !== undefined;
  const spaceId = controlled ? options.spaceId ?? '' : internalSpaceId;
  const onSpaceUnavailable = options?.onSpaceUnavailable;

  const loadDashboard = useCallback(async (nextSpaceId: string, nextMonth: string) => {
    const sequence = ++loadSequence.current;
    setDashboard(null);
    setLoading(true);
    setError(null);
    try {
      const nextDashboard = await gateway.loadDashboard(nextSpaceId, nextMonth);
      if (sequence === loadSequence.current) setDashboard(nextDashboard);
    } catch (cause) {
      if (sequence === loadSequence.current) {
        const nextError = classifyLoanError(cause);
        setError(nextError);
        if (nextError.code === 'missing_membership') onSpaceUnavailable?.();
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [gateway, onSpaceUnavailable]);

  const initialize = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const availableSpaces = await gateway.listSpaces();
      setSpaces(availableSpaces);
      const firstSpaceId = availableSpaces[0]?.id ?? '';
      setSpaceIdState(firstSpaceId);
      if (firstSpaceId) {
        setDashboard(await gateway.loadDashboard(firstSpaceId, month));
      } else {
        setDashboard(null);
      }
    } catch (cause) {
      setError(classifyLoanError(cause));
    } finally {
      setLoading(false);
    }
  }, [gateway, month]);

  useEffect(() => {
    if (!controlled) void initialize();
  }, [controlled, initialize]);

  useEffect(() => {
    if (controlled && spaceId) void loadDashboard(spaceId, month);
    if (controlled && !spaceId) {
      loadSequence.current += 1;
      setDashboard(null);
      setLoading(false);
    }
  }, [controlled, loadDashboard, month, spaceId]);

  useEffect(() => () => { loadSequence.current += 1; }, []);

  const setSpaceId = (nextSpaceId: string) => {
    if (controlled) return;
    setDashboard(null);
    setSpaceIdState(nextSpaceId);
    void loadDashboard(nextSpaceId, month);
  };

  const setMonth = (nextMonth: string) => {
    const normalized = `${nextMonth.slice(0, 7)}-01`;
    setMonthState(normalized);
    if (!controlled && spaceId) void loadDashboard(spaceId, normalized);
  };

  async function run<T extends object>(key: string, draft: T, command: (id: string) => Promise<unknown>) {
    const fingerprint = JSON.stringify(draft);
    const previous = requests.current.get(key);
    const id = previous?.fingerprint === fingerprint ? previous.id : requestId();
    requests.current.set(key, { fingerprint, id });
    await command(id);
    requests.current.delete(key);
    if (spaceId) await loadDashboard(spaceId, month);
  }

  return {
    spaces, spaceId, month, dashboard, loading, error,
    setSpaceId, setMonth, retry: controlled ? () => loadDashboard(spaceId, month) : initialize,
    createLoan: (draft: CreateDraft) => run('create', draft, (id) => gateway.createLoan({ ...draft, requestId: id })),
    recordRepayment: (draft: RepaymentDraft) => run(`repay:${draft.loanId}`, draft, (id) => gateway.recordRepayment({ ...draft, requestId: id })),
    setMonthlyTarget: (draft: TargetDraft) => run(`target:${draft.loanId}`, draft, (id) => gateway.setMonthlyTarget({ ...draft, requestId: id })),
    reverseEvent: (draft: ReversalDraft) => run(`reverse:${draft.eventId}`, draft, (id) => gateway.reverseEvent({ ...draft, requestId: id })),
  };
}
