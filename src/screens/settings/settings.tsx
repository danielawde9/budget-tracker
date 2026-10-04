import { useState, type FormEvent } from 'react';
import { PageHeader } from '../../app/shell.tsx';
import { useWorkspace } from '../../app/workspace.tsx';
import { MoneyGlossary } from '../../ui/money-help.tsx';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { IS_DEMO } from '../../preview/demo-mode.ts';
import { DemoTour } from '../../preview/tour.tsx';
import { ErrorNotice, LoadState, useCommand, useLoad } from '../../ui/async.tsx';

export function SettingsScreen({ onToggleLocale, onSignOut }: { readonly onToggleLocale: () => void; readonly onSignOut: () => void }) {
  const { t } = useI18n();
  const c = useUiCopy();
  const { api, space, version } = useWorkspace();
  const overview = useLoad(() => api.overview(space.id), [api, space.id, version]);
  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="cr-settings"><section className="cr-settings-section">
        <h2>{t('settings.language')}</h2>
        <button type="button" className="cr-button" onClick={onToggleLocale}>{t('shell.language')}</button>
      </section>
      <section className="cr-settings-section">
        <h2>{t('settings.rateTitle')}</h2>
        <p className="cr-helper">{c('referenceHelp')}</p>
        <LoadState loaded={overview}>
          {(data) => <RateForm key={data.referenceRate?.unitsPerUsd ?? 'none'} current={data.referenceRate?.unitsPerUsd ?? ''} since={data.referenceRate?.effectiveOn ?? null} />}
        </LoadState>
      </section>
      <section className="cr-settings-section">
        <h2>{t('settings.space')}</h2>
        <p><bdi>{space.name}</bdi> · {space.timezone} · {t('settings.planCurrency', { currency: space.planCurrency })}</p>
      </section>
      <section className="cr-settings-section"><h2>{c('help')}</h2><MoneyGlossary />{IS_DEMO ? <DemoTour /> : null}</section>
      <section className="cr-settings-section">
        <button type="button" className="cr-button cr-button--danger" onClick={onSignOut}>{t('settings.signOut')}</button>
      </section></div>
    </>
  );
}

function RateForm({ current, since }: { readonly current: string; readonly since: string | null }) {
  const { t, date } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const [rate, setRate] = useState(current);
  const [on, setOn] = useState(space.today);
  const [saved, setSaved] = useState(false);
  const command = useCommand((requestId, _: null) => api.setReferenceRate({ spaceId: space.id, requestId, unitsPerUsd: rate.trim(), effective: on }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,6})?$/.test(rate.trim())) return;
    if (await command.submit(null)) {
      setSaved(true);
      refresh();
    }
  }
  return (
    <form className="cr-stack" onSubmit={(event) => void submit(event)}>
      {since ? <p className="cr-helper">{t('settings.rateSince', { date: date(since) })}</p> : null}
      <label className="cr-field">
        <span className="cr-label">{t('settings.rateLabel')}</span>
        <input type="text" inputMode="decimal" dir="ltr" required value={rate} onChange={(event) => { setRate(event.target.value); setSaved(false); }} />
      </label>
      <label className="cr-field">
        <span className="cr-label">{t('settings.rateFrom')}</span>
        <input type="date" dir="ltr" required value={on} max={space.today} onChange={(event) => setOn(event.target.value)} />
      </label>
      {command.error ? <ErrorNotice error={command.error} /> : null}
      {saved ? <p role="status" className="cr-helper">{t('common.saved')}</p> : null}
      <button type="submit" className="cr-button cr-button--primary" disabled={command.pending}>{t('common.save')}</button>
    </form>
  );
}
