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

export function useLoans(gateway: LoansGateway) {
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [spaceId, setSpaceIdState] = useState('');
  const [month, setMonthState] = useState(currentMonth());
  const [dashboard, setDashboard] = useState<LoansDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoanErrorView | null>(null);
  const requests = useRef(new Map<string, { fingerprint: string; id: string }>());

  const loadDashboard = useCallback(async (nextSpaceId: string, nextMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await gateway.loadDashboard(nextSpaceId, nextMonth));
    } catch (cause) {
      setError(classifyLoanError(cause));
    } finally {
      setLoading(false);
    }
  }, [gateway]);

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

  useEffect(() => { void initialize(); }, [initialize]);

  const setSpaceId = (nextSpaceId: string) => {
    setSpaceIdState(nextSpaceId);
    void loadDashboard(nextSpaceId, month);
  };

  const setMonth = (nextMonth: string) => {
    const normalized = `${nextMonth.slice(0, 7)}-01`;
    setMonthState(normalized);
    if (spaceId) void loadDashboard(spaceId, normalized);
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
    setSpaceId, setMonth, retry: initialize,
    createLoan: (draft: CreateDraft) => run('create', draft, (id) => gateway.createLoan({ ...draft, requestId: id })),
    recordRepayment: (draft: RepaymentDraft) => run(`repay:${draft.loanId}`, draft, (id) => gateway.recordRepayment({ ...draft, requestId: id })),
    setMonthlyTarget: (draft: TargetDraft) => run(`target:${draft.loanId}`, draft, (id) => gateway.setMonthlyTarget({ ...draft, requestId: id })),
    reverseEvent: (draft: ReversalDraft) => run(`reverse:${draft.eventId}`, draft, (id) => gateway.reverseEvent({ ...draft, requestId: id })),
  };
}
