import { loadConnection, completeConnection, createCredentials, type ConnectionDetails } from './mcp-connection.ts';
import { useEffect, useRef, useState } from 'react';
import type { BudgetApi } from '../api/budget-api.ts';
import type { SpaceSummary } from '../api/schemas.ts';
import { useI18n } from '../lib/i18n.tsx';
import { publicPath } from '../public-site/site.ts';

export function OAuthConsent({ api, connectionId, onRedirect = url => window.location.assign(url) }: {
  readonly api: BudgetApi; readonly connectionId: string;
  readonly onRedirect?: (url: string) => void;
}) {
  const { locale } = useI18n();
  const c = (en: string, ar: string) => locale === 'ar' ? ar : en;
  const [details, setDetails] = useState<ConnectionDetails | null>(null);
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const redirect = useRef(onRedirect);
  redirect.current = onRedirect;
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [result, list] = await Promise.all([loadConnection(connectionId), api.mySpaces()]);
        if (!active) return;
        const owned = list.filter(space => space.role === 'owner');
        setDetails(result); setSpaces(owned);
        if (owned.length === 1) setSelected(owned[0]!.id);
      } catch { if (active) setError(true); }
    })();
    return () => { active = false; };
  }, [api, connectionId]);

  async function decide(approve: boolean) {
    if (!details || inFlight.current || (approve && !selected)) return;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      if (approve) {
        const credentials = await createCredentials();
        await api.mcpGrantClient(details.clientId, selected, details.clientName.slice(0,120) || 'MCP client', credentials.tokenHash, credentials.codeHash);
        redirect.current(await completeConnection(connectionId, { decision: 'approve', grantToken: credentials.grantToken, code: credentials.code }));
      } else {
        redirect.current(await completeConnection(connectionId, { decision: 'deny' }));
      }
    } catch { setError(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-boundary cr-stack">
    <h1>{c('Connect your budget', 'اربط ميزانيتك')}</h1>
    {error ? <p role="alert">{c('Could not complete the connection. Try again or restart the connection from your AI client.', 'تعذّر إكمال الاتصال. حاول مجددًا أو أعد بدء الاتصال من تطبيق الذكاء الاصطناعي.')}</p> : null}
    {!details && !error ? <p role="status">{c('Loading connection…', 'جارٍ تحميل الاتصال…')}</p> : null}
    {details ? <>
      <p><bdi>{details.clientName || 'MCP client'}</bdi></p>
      <p className="cr-helper">{c('This client can see wallet and plan-item names and save expenses and income directly when you ask. Your requests and returned data pass through that client. Budget saves a complete request directly; your AI client may ask for approval. Access lasts 90 days; revoke it anytime in Settings.', 'يمكن لهذا التطبيق رؤية أسماء المحافظ وبنود الخطة وتسجيل المصاريف والدخل مباشرةً عند طلبك. تمر طلباتك والبيانات المُعادة عبر هذا التطبيق. تحفظ الميزانية الطلب المكتمل مباشرةً وقد يطلب تطبيق الذكاء الاصطناعي موافقتك. يستمر الوصول ٩٠ يومًا ويمكنك إلغاؤه في الإعدادات.')}</p>
      {details.redirectIsLoopback ? <p className="cr-helper">{c('This connects an app on your computer. Continue only if you just started this connection.', 'يتصل هذا بتطبيق على جهازك. تابع فقط إذا كنت قد بدأت هذا الاتصال للتو.')}</p> : null}
      <p className="cr-helper">{c('The client name is supplied by the client.', 'يُقدّم التطبيق اسمه بنفسه.')}</p>
      <p className="cr-helper">{c('Return to', 'العودة إلى')}: <bdi>{details.redirectUri}</bdi></p>
      <label className="cr-field"><span className="cr-label">{c('Budget space', 'مساحة الميزانية')}</span>
        <select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>
          <option value="">{c('Choose a space', 'اختر مساحة')}</option>
          {spaces.map(space => <option value={space.id} key={space.id}>{space.name}</option>)}
        </select>
      </label>
      {!spaces.length ? <p>{c('Only the owner of an existing budget can connect it.', 'يمكن لمالك ميزانية موجودة فقط ربطها.')}</p> : null}
      <nav className="cr-public-nav" aria-label={c('Connection policies and help', 'سياسات الاتصال والمساعدة')}>
        <a href={publicPath('privacy', locale)} target="_blank" rel="noopener noreferrer">{c('Privacy policy', 'سياسة الخصوصية')}</a>
        <a href={publicPath('terms', locale)} target="_blank" rel="noopener noreferrer">{c('Terms of use', 'شروط الاستخدام')}</a>
        <a href={publicPath('support', locale)} target="_blank" rel="noopener noreferrer">{c('Support', 'المساعدة')}</a>
      </nav>
      <button className="cr-button cr-button--primary" disabled={busy || !selected} onClick={() => void decide(true)}>{c('Connect and allow direct saves', 'اربط واسمح بالحفظ المباشر')}</button>
      <button className="cr-button" disabled={busy} onClick={() => void decide(false)}>{c('Deny', 'رفض')}</button>
    </> : null}
  </section></main>;
}
