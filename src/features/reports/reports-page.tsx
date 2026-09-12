import { useEffect, useState } from 'react';
import { formatMinorAmount } from '../wallets/money.js';
import type { Locale } from '../loans/types.js';
import type { MonthlyCashSummary, ReportsGateway } from './types.js';

export function ReportsPage({ gateway, locale, spaceId }: { gateway: ReportsGateway; locale: Locale; spaceId: string }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<readonly MonthlyCashSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; setRows(null); setError(null); void gateway.loadMonthlyComparison(spaceId, `${month}-01`).then((value) => { if (active) setRows(value); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Reports are unavailable.'); }); return () => { active = false; }; }, [gateway, month, spaceId]);
  return <section className="reports-workspace"><header className="topbar page-header"><div><span className="brand">{locale === 'ar' ? 'تقارير الدفتر' : 'Ledger reports'}</span><h1>{locale === 'ar' ? 'التقارير' : 'Reports'}</h1><p>{locale === 'ar' ? 'مقارنة الدخل والمصروفات حسب العملة.' : 'Compare ordinary income and spending without mixing currencies.'}</p></div><label>{locale === 'ar' ? 'الشهر' : 'Month'}<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></header>
    {error ? <div className="state-panel error-notice" role="alert">{error}</div> : null}
    {!rows && !error ? <div className="state-panel" role="status">{locale === 'ar' ? 'جارٍ تحميل التقارير…' : 'Loading reports…'}</div> : null}
    {rows ? <section className="wallet-folio" aria-label={locale === 'ar' ? 'مقارنة شهرية' : 'Monthly comparison'}><div className="section-heading"><h2>{locale === 'ar' ? 'المقارنة الشهرية' : 'Month comparison'}</h2></div><ul className="wallet-list">{rows.map((row) => <li key={`${row.periodRole}-${row.currency}`}><div><strong>{row.periodRole === 'current' ? (locale === 'ar' ? 'الحالي' : 'Current') : (locale === 'ar' ? 'السابق' : 'Previous')}</strong><span>{row.currency}</span></div><div><span>{locale === 'ar' ? 'دخل' : 'Income'} <bdi>{formatMinorAmount(row.incomeNetMinor, row.currency, locale)}</bdi></span><span>{locale === 'ar' ? 'مصروفات' : 'Spent'} <bdi>{formatMinorAmount(row.expenseNetMinor, row.currency, locale)}</bdi></span><strong><bdi>{formatMinorAmount(row.walletDeltaNetMinor, row.currency, locale)}</bdi></strong></div></li>)}</ul></section> : null}
  </section>;
}
