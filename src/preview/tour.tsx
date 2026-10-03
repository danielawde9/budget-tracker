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
  { title: 'tour.1.title', body: 'tour.1.body', route: () => null },
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

/** Preview only: the ten demonstrations, each linked to where it shows. */
export function DemoTour() {
  const { t } = useI18n();
  const { space } = useWorkspace();
  return (
    <section className="cr-card cr-demo-panel" aria-labelledby="tour-heading">
      <h2 id="tour-heading">{t('tour.title')}</h2>
      <p className="cr-helper">{t('tour.intro')}</p>
      <ol className="cr-steps cr-tour">
        {STOPS.map((stop) => {
          const route = stop.route(space.currentMonth);
          return (
            <li key={stop.title}>
              <strong>{t(stop.title)}</strong>
              <p className="cr-helper">{t(stop.body)}</p>
              {route ? <button type="button" className="text-button" onClick={() => navigate(route)}>{t('tour.show')}</button> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
