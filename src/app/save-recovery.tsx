import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SaveRecoveryStore } from '../api/save-recovery.ts';
import { toBudgetError, type BudgetError } from '../api/budget-api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { ErrorNotice } from '../ui/async.tsx';
import { useWorkspace } from './workspace.tsx';
const RecoveryContext = createContext<SaveRecoveryStore | null>(null);
const noopSubscribe = () => () => {};
const zero = () => 0;
export function SaveRecoveryProvider({ store, children }: { readonly store: SaveRecoveryStore; readonly children: ReactNode }) {
  return <RecoveryContext.Provider value={store}>{children}</RecoveryContext.Provider>;
}
export function useSaveRecovery(spaceId: string) {
  const store = useContext(RecoveryContext);
  useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.snapshot ?? zero);
  return { store, attempt: store?.get(spaceId) };
}
export function SaveRecoveryNotice({ onFinished }: { readonly onFinished?: () => void }) {
  const { space, refresh } = useWorkspace();
  const { store, attempt } = useSaveRecovery(space.id);
  const { t } = useI18n();
  const [error, setError] = useState<BudgetError | null>(null);
  useEffect(() => { if (attempt?.status === 'uncertain') refresh(); }, [attempt?.requestId, attempt?.status, refresh]);
  const finish = async () => {
    setError(null);
    try { await store?.retry(space.id); refresh(); onFinished?.(); }
    catch (caught) { setError(toBudgetError(caught)); refresh(); }
  };
  if (!attempt?.wasUncertain) return error ? <ErrorNotice error={error} /> : null;
  return <section className="cr-card cr-stack" role="alert" aria-label={t('recovery.title')}>
    <h2>{t('recovery.title')}</h2><p className="cr-helper">{t('recovery.help')}</p>
    <button type="button" className="cr-button" disabled={attempt.status === 'pending'} onClick={() => void finish()}>{attempt.status === 'pending' ? t('common.saving') : t('recovery.finish')}</button>
    {error ? <ErrorNotice error={error} /> : null}
  </section>;
}
