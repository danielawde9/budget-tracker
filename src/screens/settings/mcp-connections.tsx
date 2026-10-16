import { useState } from 'react';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { ErrorNotice, LoadState, useLoad } from '../../ui/async.tsx';
import { toBudgetError } from '../../api/budget-api.ts';

export function McpConnections() {
  const { api } = useWorkspace();
  const { locale } = useI18n();
  const c = (en: string, ar: string) => locale === 'ar' ? ar : en;
  const connections = useLoad(() => api.mcpConnections(), [api]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function revoke(clientId: string) {
    if (pending) return;
    setPending(clientId); setError(null);
    try {
      // Stop database access first, even if the native OAuth revocation fails.
      await api.mcpRevokeClient(clientId);
      connections.reload();
    } catch (cause) { setError(cause); }
    finally { setPending(null); }
  }
  return <section className="cr-settings-section">
    <h2>{c('AI connections', 'اتصالات الذكاء الاصطناعي')}</h2>
    <p className="cr-helper">{c('Connect your AI client to https://mcp.openbudgetracker.app/mcp, then sign in to allow direct expense and income saves.', 'اربط تطبيق الذكاء الاصطناعي بالرابط https://mcp.openbudgetracker.app/mcp ثم سجّل الدخول للسماح بحفظ المصاريف والدخل مباشرةً.')}</p>
    {error ? <ErrorNotice error={toBudgetError(error)} /> : null}
    <LoadState loaded={connections}>{list => list.length ? <ul>{list.map(connection => <li key={connection.clientId}>
      <bdi>{connection.name}</bdi>{' '}
      <button className="cr-button cr-button--danger" disabled={pending !== null} onClick={() => void revoke(connection.clientId)}>{c('Disconnect', 'قطع الاتصال')}</button>
    </li>)}</ul> : <p className="cr-helper">{c('No AI clients connected.', 'لا توجد تطبيقات ذكاء اصطناعي متصلة.')}</p>}</LoadState>
  </section>;
}
