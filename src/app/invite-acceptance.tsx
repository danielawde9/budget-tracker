import type { BudgetApi } from '../api/budget-api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { ErrorNotice, useCommand } from '../ui/async.tsx';
import { PageMetadata } from './page-metadata.tsx';
import { navigate } from './router.ts';

export function InviteAcceptance({ api, token, onAccepted, onSignOut }: {
  readonly api: BudgetApi; readonly token: string;
  readonly onAccepted: (spaceId: string) => void; readonly onSignOut: () => void;
}) {
  const { t } = useI18n();
  const command = useCommand((_, __: null) => api.acceptSpaceInvitation(token));
  return <main className="auth-page"><PageMetadata page="invite" /><section className="auth-boundary cr-stack">
    <h1>{t('invite.acceptTitle')}</h1>
    <p>{t('invite.acceptHelp')}</p>
    {command.error ? <ErrorNotice error={command.error} /> : null}
    <button type="button" className="cr-button cr-button--primary" disabled={command.pending} onClick={() => void command.submit(null).then(result => { if (result) onAccepted(result.spaceId); })}>{t('invite.accept')}</button>
    <button type="button" className="cr-button" disabled={command.pending} onClick={onSignOut}>{t('invite.switchAccount')}</button>
    <button type="button" className="text-button" disabled={command.pending} onClick={() => navigate({ name: 'home' })}>{t('common.cancel')}</button>
  </section></main>;
}
