import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList, type ReactNode } from 'react';
import { useCommandScope } from './command-pending.tsx';
import { BudgetError, toBudgetError } from '../api/budget-api.ts';
import { newRequestId } from '../api/request-id.ts';
import { isMessageKey, useI18n, type I18n } from '../lib/i18n.tsx';

export type Loaded<T> =
  | { readonly status: 'loading'; readonly data: T | null; readonly reload: () => void }
  | { readonly status: 'ready'; readonly data: T; readonly reload: () => void }
  | { readonly status: 'error'; readonly data: T | null; readonly error: BudgetError; readonly reload: () => void };

/** Loads data; a newer request always wins over a slower older one. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): Loaded<T> {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data: T | null; error: BudgetError | null }>({ status: 'loading', data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    setState((previous) => ({ status: 'loading', data: previous.data, error: null }));
    load().then(
      (data) => {
        if (latest.current === ticket) setState({ status: 'ready', data, error: null });
      },
      (error: unknown) => {
        if (latest.current === ticket) setState((previous) => ({ status: 'error', data: previous.data, error: toBudgetError(error) }));
      },
    );
    // Callers pass the real dependencies of `load`; `nonce` forces a reload.
  }, [...deps, nonce]);
  // One object per state: screens key effects and memos on it, so a fresh
  // object on every render would re-run them after every render.
  return useMemo<Loaded<T>>(() => {
    if (state.status === 'ready' && state.data !== null) return { status: 'ready', data: state.data, reload };
    if (state.status === 'error' && state.error) return { status: 'error', data: state.data, error: state.error, reload };
    return { status: 'loading', data: state.data, reload };
  }, [state, reload]);
}

/** A readable sentence for an error code, with its detail filled in. */
export function errorText(i18n: I18n, error: BudgetError): string {
  const key = `error.${error.code}`;
  const detail = error.detail;
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(detail)) if (typeof value === 'string') vars[name] = value;
  const currency = detail['currency'] === 'LBP' ? 'LBP' : 'USD';
  for (const money of ['available', 'needed', 'owed']) {
    const raw = detail[money];
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) vars[money] = i18n.money(BigInt(raw), currency);
  }
  if (typeof detail['nameEn'] === 'string' || typeof detail['nameAr'] === 'string') {
    vars['name'] = i18n.name({ nameEn: (detail['nameEn'] as string | undefined) ?? null, nameAr: (detail['nameAr'] as string | undefined) ?? null });
  }
  return isMessageKey(key) ? i18n.t(key, vars) : i18n.t('error.UNKNOWN');
}

export function ErrorNotice({ error, onRetry }: { readonly error: BudgetError; readonly onRetry?: () => void }) {
  const i18n = useI18n();
  return (
    <div className="error-notice" role="alert">
      <p>{errorText(i18n, error)}</p>
      {onRetry ? <button type="button" className="cr-button cr-button--sm" onClick={onRetry}>{i18n.t('common.retry')}</button> : null}
    </div>
  );
}

export function LoadState<T>({ loaded, children, skeleton }: { readonly loaded: Loaded<T>; readonly children: (data: T) => ReactNode; readonly skeleton?: ReactNode }) {
  const { t } = useI18n();
  if (loaded.data !== null) {
    return (
      <>
        {loaded.status === 'error' ? <ErrorNotice error={loaded.error} onRetry={loaded.reload} /> : null}
        {children(loaded.data)}
      </>
    );
  }
  if (loaded.status === 'error') return <ErrorNotice error={loaded.error} onRetry={loaded.reload} />;
  return <>{skeleton ?? <p role="status" className="cr-helper">{t('common.loading')}</p>}</>;
}

/**
 * Runs one command. The request id is created with the form and reused for
 * every retry, so a retry after a lost response can never record twice; a
 * second click while pending does nothing.
 */
export function useCommand<A, R>(run: (requestId: string, args: A) => Promise<R>) {
  const scope = useCommandScope();
  const [requestId, setRequestId] = useState(newRequestId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BudgetError | null>(null);
  const inFlight = useRef(false);
  const submit = useCallback(async (args: A): Promise<R | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    const stopPending = scope?.start();
    setPending(true);
    setError(null);
    try {
      const result = await run(requestId, args);
      setRequestId(newRequestId());
      return result;
    } catch (caught) {
      setError(toBudgetError(caught));
      return null;
    } finally {
      stopPending?.();
      inFlight.current = false;
      setPending(false);
    }
  }, [run, requestId, scope?.start]);
  const resetRequest = useCallback(() => {
    if (inFlight.current) return;
    setRequestId(newRequestId());
    setError(null);
  }, []);
  return { submit, pending, error, resetRequest, clearError: () => setError(null) };
}
