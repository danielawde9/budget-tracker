import { BudgetError, toBudgetError } from './budget-api.ts';

export interface SaveAttempt {
  readonly spaceId: string;
  readonly requestId: string;
  readonly rpc: string;
  readonly payload: string;
  readonly send: () => Promise<unknown>;
  status: 'pending' | 'uncertain';
  wasUncertain?: boolean;
}

/** Memory only. Exact encoded payloads never enter browser storage or logs. */
export class SaveRecoveryStore {
  private attempts = new Map<string, SaveAttempt>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  get = (spaceId: string) => this.attempts.get(spaceId);
  private emit() { this.version++; this.listeners.forEach((listener) => listener()); }
  clear() { this.attempts.clear(); this.emit(); }
  async perform<T>(spaceId: string, requestId: string, rpc: string, payload: string, send: () => Promise<T>): Promise<T> {
    const previous = this.attempts.get(spaceId);
    if (previous?.status === 'pending') throw new BudgetError('SAVE_PENDING');
    if (previous && (previous.requestId !== requestId || previous.rpc !== rpc || previous.payload !== payload)) throw new BudgetError('SAVE_UNRESOLVED');
    const attempt = previous ?? { spaceId, requestId, rpc, payload, send, status: 'pending' as const };
    attempt.status = 'pending'; this.attempts.set(spaceId, attempt); this.emit();
    try {
      const result = await attempt.send();
      if (this.attempts.get(spaceId) === attempt) this.attempts.delete(spaceId);
      this.emit(); return result as T;
    } catch (caught) {
      const error = toBudgetError(caught);
      if (error.code.startsWith('BUDGET_')) { if (this.attempts.get(spaceId) === attempt) this.attempts.delete(spaceId); }
      else { attempt.status = 'uncertain'; attempt.wasUncertain = true; }
      this.emit(); throw error;
    }
  }
  retry(spaceId: string) {
    const attempt = this.attempts.get(spaceId);
    if (!attempt) return Promise.resolve(null);
    return this.perform(spaceId, attempt.requestId, attempt.rpc, attempt.payload, attempt.send);
  }
}
