import { createContext, useContext, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useUiCopy } from '../lib/ui-copy.ts';
import { IS_DEMO } from './demo-mode.ts';
import { navigate, type Route } from '../app/router.ts';
import { useWorkspace } from '../app/workspace.tsx';
import { useI18n, type MessageKey } from '../lib/i18n.tsx';
import { addMonths } from '../screens/describe.ts';

interface Stop {
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly route: (current: string) => Route | null;
}

const STOPS: readonly Stop[] = [
  { title: 'tour.1.title', body: 'tour.1.body', route: () => ({ name: 'home' }) },
  { title: 'tour.2.title', body: 'tour.2.body', route: (current) => ({ name: 'plan', month: addMonths(current, -1) }) },
  { title: 'tour.3.title', body: 'tour.3.body', route: (current) => ({ name: 'plan', month: addMonths(current, -1) }) },
  { title: 'tour.4.title', body: 'tour.4.body', route: () => ({ name: 'plan', month: null }) },
  { title: 'tour.5.title', body: 'tour.5.body', route: (current) => ({ name: 'plan', month: addMonths(current, -1) }) },
  { title: 'tour.6.title', body: 'tour.6.body', route: () => ({ name: 'plan', month: null }) },
  { title: 'tour.7.title', body: 'tour.7.body', route: () => ({ name: 'activity' }) },
  { title: 'tour.8.title', body: 'tour.8.body', route: () => ({ name: 'plan', month: null }) },
  { title: 'tour.9.title', body: 'tour.9.body', route: () => ({ name: 'accounts' }) },
  { title: 'tour.10.title', body: 'tour.10.body', route: () => ({ name: 'home' }) },
];

interface TourState { step: number | null; start: () => void; move: (step: number) => void; finish: () => void; dismissed: boolean; dismiss: () => void; }
const TourContext = createContext<TourState | null>(null);
export function DemoTourProvider({ children }: { readonly children: ReactNode }) {
  const { space } = useWorkspace();
  const key = `budget:tour:${space.id}`;
  const [step, setStep] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === 'done'; } catch { return false; } });
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(key, 'done'); } catch { /* Tour remains usable without storage. */ } };
  const move = (next: number) => { setStep(next); const route = STOPS[next]?.route(space.currentMonth); if (route) navigate(route); };
  const finish = () => { setStep(null); dismiss(); };
  return <TourContext.Provider value={{ step, start: () => move(0), move, finish, dismissed, dismiss }}>{children}</TourContext.Provider>;
}
export function DemoTourInvite() {
  const tour = useContext(TourContext);
  const c = useUiCopy();
  const { t } = useI18n();
  if (!IS_DEMO || !tour || tour.dismissed || tour.step !== null) return null;
  return <aside className="cr-tour-invite"><p>{c('tourIntro')}</p><button type="button" className="text-button" onClick={tour.start}>{c('startTour')}</button><button type="button" className="cr-icon-button" aria-label={t('common.close')} onClick={tour.dismiss}><X size={18} aria-hidden /></button></aside>;
}
export function DemoTour() {
  const tour = useContext(TourContext);
  const c = useUiCopy();
  return <section className="cr-help-section"><button type="button" className="text-button" onClick={() => tour?.start()}>{tour?.dismissed ? c('restartTour') : c('startTour')}</button></section>;
}
export function DemoTourPanel() {
  const tour = useContext(TourContext);
  const { t } = useI18n();
  const c = useUiCopy();
  const stop = tour?.step === null || tour?.step === undefined ? null : STOPS[tour.step];
  if (!tour || !stop || tour.step === null) return null;
  return <aside className="cr-tour-panel" role="region" aria-label={c('tourProgress')}><div className="cr-section-header"><span className="cr-helper">{tour.step + 1} / {STOPS.length}</span><button type="button" className="cr-icon-button" onClick={tour.finish} aria-label={t('common.close')}><X size={18} aria-hidden /></button></div><div aria-live="polite"><h2>{t(stop.title)}</h2><p>{t(stop.body)}</p></div><div className="cr-tour-actions"><button type="button" className="text-button" onClick={tour.finish}>{c('skipTour')}</button>{tour.step > 0 ? <button type="button" className="cr-button" onClick={() => tour.move((tour.step ?? 0) - 1)}>{t('common.back')}</button> : null}<button type="button" className="cr-button cr-button--primary" onClick={() => tour.step === STOPS.length - 1 ? tour.finish() : tour.move((tour.step ?? 0) + 1)}>{tour.step === STOPS.length - 1 ? c('tourDone') : t('common.next')}</button></div></aside>;
}
