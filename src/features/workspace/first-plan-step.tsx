import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftRight, ArrowRight, Car, House, Plus, ShoppingCart, Trash2, UserRound } from 'lucide-react';
import type { Currency, Locale } from '../loans/types.js';
import type { CategoriesGateway } from '../categories/types.js';
import type { PlanClient } from '../plan/types.js';
import type { SpaceClock } from './space-clock.js';
import { formatMinorAmount } from '../wallets/money.js';
import { monthLabel } from '../plan/plan-page.js';
import { amountFromPercent, majorInput, parsePlanAmount, percentFromAmount } from './first-plan-money.js';
import { createFirstPlanSaver } from './first-plan-save.js';

export interface FirstPlanServices {
  plan: PlanClient;
  categories: CategoriesGateway;
  loadClock(spaceId: string): Promise<SpaceClock>;
}
interface Props {
  locale: Locale;
  spaceId: string;
  initialCurrency: Currency;
  services: FirstPlanServices;
  onComplete(): void;
  onBack?: (() => void) | undefined;
}
interface Row {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  amount: string;
  percent: string;
  basis: 'amount' | 'percent';
  custom?: boolean;
}
interface Draft { income: string; rows: Row[] }
const suggestions = [
  { id: 'rent', nameEn: 'Rent & bills', nameAr: 'الإيجار والفواتير', placeholder: '900', Icon: House },
  { id: 'groceries', nameEn: 'Groceries', nameAr: 'البقالة', placeholder: '350', Icon: ShoppingCart },
  { id: 'transport', nameEn: 'Transport', nameAr: 'المواصلات', placeholder: '150', Icon: Car },
  { id: 'personal', nameEn: 'Personal spending', nameAr: 'المصروف الشخصي', placeholder: '200', Icon: UserRound },
];
const blankDraft = (): Draft => ({ income: '', rows: suggestions.map(row => ({ id: row.id, nameEn: row.nameEn, nameAr: row.nameAr, amount: '', percent: '', basis: 'amount' })) });
const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;
function safeMinor(raw: string, currency: Currency): string | null {
  try { return parsePlanAmount(raw, currency); } catch { return null; }
}
function resolveRow(row: Row, income: string | null, currency: Currency): Row {
  try {
    if (row.basis === 'percent') {
      return { ...row, amount: row.percent && income && BigInt(income) > 0n ? majorInput(amountFromPercent(row.percent, income), currency) : '' };
    }
    const amount = safeMinor(row.amount, currency);
    return { ...row, percent: amount !== null && income ? percentFromAmount(amount, income) : '' };
  } catch { return { ...row, ...(row.basis === 'percent' ? { amount: '' } : { percent: '' }) }; }
}

function readDraft(spaceId: string): { drafts: Record<Currency, Draft>; currency: Currency; month: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`budget:first-plan-draft:${spaceId}`) ?? 'null');
    if (!value || !['USD', 'LBP'].includes(value.currency) || typeof value.month !== 'string') return null;
    for (const currency of ['USD', 'LBP'] as const) {
      const draft = value.drafts?.[currency];
      if (!draft || typeof draft.income !== 'string' || draft.income.length > 24 || !Array.isArray(draft.rows) || draft.rows.length > 100) return null;
      if (draft.rows.some((row: Row) => !row || typeof row.id !== 'string' || typeof row.amount !== 'string' || row.amount.length > 24
        || typeof row.percent !== 'string' || row.percent.length > 24 || !['amount', 'percent'].includes(row.basis)
        || !(row.nameEn === null || typeof row.nameEn === 'string') || !(row.nameAr === null || typeof row.nameAr === 'string'))) return null;
    }
    return value;
  } catch { return null; }
}

function monthOptions(currentMonth: string): string[] {
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(`${currentMonth}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 10);
  });
}

export function FirstPlanStep({ locale, spaceId, initialCurrency, services, onComplete, onBack }: Props) {
  const [restored] = useState(() => readDraft(spaceId));
  const [currency, setCurrency] = useState<Currency>(restored?.currency ?? initialCurrency);
  const [drafts, setDrafts] = useState<Record<Currency, Draft>>(restored?.drafts ?? { USD: blankDraft(), LBP: blankDraft() });
  const [clock, setClock] = useState<SpaceClock | null>(null);
  const [month, setMonth] = useState(restored?.month ?? '');
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const save = useMemo(() => createFirstPlanSaver(services.plan, services.categories, `budget:first-plan-requests:${spaceId}`), [services.plan, services.categories, spaceId]);
  useEffect(() => {
    let active = true;
    setLoadError(false);
    void services.loadClock(spaceId).then(value => {
      if (active) { setClock(value); setMonth(current => monthOptions(value.currentMonth).includes(current) ? current : value.currentMonth); }
    }, () => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [services.loadClock, spaceId, loadAttempt]);

  useEffect(() => {
    try { sessionStorage.setItem(`budget:first-plan-draft:${spaceId}`, JSON.stringify({ drafts, currency, month })); } catch { /* optional storage */ }
  }, [drafts, currency, month, spaceId]);
  const clearDraft = () => {
    try {
      sessionStorage.removeItem(`budget:first-plan-draft:${spaceId}`);
      sessionStorage.removeItem(`budget:first-plan-requests:${spaceId}`);
      sessionStorage.removeItem(`budget:first-plan-requests:${spaceId}:targets`);
    } catch { /* optional storage */ }
  };

  const draft = drafts[currency];
  const income = safeMinor(draft.income, currency);
  const planned = draft.rows.reduce((sum, row) => sum + BigInt(safeMinor(row.amount, currency) ?? '0'), 0n);
  const remaining = BigInt(income ?? '0') - planned;
  const allocated = income && BigInt(income) > 0n ? percentFromAmount(planned.toString(), income) : '0';
  const remainingPercent = income && BigInt(income) > 0n && remaining >= 0n ? percentFromAmount(remaining.toString(), income) : '0';
  const symbol = currency === 'USD' ? '$' : 'LBP';
  const name = (row: Row) => (locale === 'ar' ? row.nameAr ?? row.nameEn : row.nameEn ?? row.nameAr) ?? '';
  const update = (fn: (value: Draft) => Draft) => {
    setError(null);
    setDrafts(current => ({ ...current, [currency]: fn(current[currency]) }));
  };
  const updateRow = (rowId: string, field: 'amount' | 'percent', value: string) => {
    update(current => ({ ...current, rows: current.rows.map(row => row.id === rowId
      ? resolveRow({ ...row, [field]: value, basis: field }, safeMinor(current.income, currency), currency) : row) }));
  };
  const changeIncome = (value: string) => update(current => ({ income: value, rows: current.rows.map(row => resolveRow(row, safeMinor(value, currency), currency)) }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !clock) return;
    if (!income || BigInt(income) <= 0n) {
      setError(t(locale, 'Enter a positive monthly income before creating your plan.', 'أدخل دخلًا شهريًا موجبًا قبل إنشاء خطتك.'));
      formRef.current?.querySelector<HTMLInputElement>('[name="monthly-income"]')?.focus();
      return;
    }
    const selected = draft.rows.filter(row => row.amount.trim() !== '' || row.percent.trim() !== '');
    if (selected.some(row => safeMinor(row.amount, currency) === null || !name(row).trim() || name(row).trim().length > 120)) {
      setError(t(locale, 'Enter a category name and a valid amount or percentage. USD supports two decimals; LBP uses whole amounts.', 'أدخل اسم الفئة ومبلغًا أو نسبة صالحة. الدولار يقبل منزلتين عشريتين والليرة أعدادًا صحيحة.'));
      return;
    }
    const normalizedNames = selected.map(row => name(row).trim().toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setError(t(locale, 'Use a different name for each category.', 'استخدم اسمًا مختلفًا لكل فئة.'));
      return;
    }
    if (remaining < 0n) {
      setError(t(locale, 'Planned expenses exceed your income. Reduce an amount or increase your income.', 'المصروف المخطط يتجاوز دخلك. خفّض مبلغًا أو زد دخلك.'));
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await save({ spaceId, month, currency, incomeMinor: income, rows: selected.map(row => ({ nameEn: row.nameEn?.trim() || null, nameAr: row.nameAr?.trim() || null, amountMinor: parsePlanAmount(row.amount, currency) })) });
      clearDraft();
      onComplete();
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : t(locale, 'Could not save the plan.', 'تعذر حفظ الخطة.')} ${t(locale, 'Your entries are kept. Some items may already be saved; try again to finish.', 'تم الاحتفاظ بإدخالاتك. قد تكون بعض البنود محفوظة؛ حاول مجددًا لإكمال الحفظ.')}`);
    } finally { busy.current = false; setPending(false); }
  };
  const finishLater = () => { if (!busy.current) { clearDraft(); onComplete(); } };
  const months = clock ? monthOptions(clock.currentMonth) : [];

  return <form ref={formRef} className="first-plan-form" onSubmit={event => void submit(event)} noValidate>
    <div className="first-plan-heading">
      <div><h1 id="onboarding-title">{t(locale, 'Make your first monthly plan', 'أنشئ خطتك الشهرية الأولى')}</h1><p>{t(locale, 'Start with estimates. You can change everything later.', 'ابدأ بتقديرات. يمكنك تعديل كل شيء لاحقًا.')}</p></div>
      <div className="first-plan-options">
        <label><span className="cr-visually-hidden">{t(locale, 'Plan month', 'شهر الخطة')}</span><select value={month} disabled={!clock || pending} onChange={event => { setMonth(event.target.value); setError(null); }}>{months.map(value => <option key={value} value={value}>{monthLabel(value, locale)}</option>)}</select></label>
        <fieldset className="first-plan-currencies"><legend className="cr-visually-hidden">{t(locale, 'Plan currency', 'عملة الخطة')}</legend>{(['USD', 'LBP'] as const).map(value => <label key={value}><input type="radio" name="plan-currency" checked={currency === value} disabled={pending} onChange={() => { setCurrency(value); setError(null); }} /><span>{value}</span></label>)}</fieldset>
        <small>{t(locale, 'Plan each currency separately.', 'خطط لكل عملة على حدة.')}</small>
      </div>
    </div>
    {loadError ? <div className="error-notice" role="alert">{t(locale, 'Could not load your plan month.', 'تعذر تحميل شهر الخطة.')} <button type="button" onClick={() => setLoadAttempt(value => value + 1)}>{t(locale, 'Try again', 'حاول مجددًا')}</button></div> : !clock ? <p role="status">{t(locale, 'Loading your plan…', 'جارٍ تحميل خطتك…')}</p> : null}
    <div className="first-plan-layout">
      <fieldset className="first-plan-fields" disabled={pending || !clock}>
        <legend className="cr-visually-hidden">{t(locale, 'Income and expenses', 'الدخل والمصروف')}</legend>
        <section className="first-plan-income">
          <h2>{t(locale, 'What income do you expect?', 'ما الدخل الذي تتوقعه؟')}</h2>
          <label htmlFor={`${id}-income`}>{t(locale, 'Monthly income', 'الدخل الشهري')}</label>
          <div className="first-plan-money-field" dir="ltr"><span aria-hidden="true">{symbol}</span><input id={`${id}-income`} name="monthly-income" inputMode={currency === 'USD' ? 'decimal' : 'numeric'} maxLength={24} autoComplete="off" placeholder="0" value={draft.income} onChange={event => changeIncome(event.target.value)} aria-describedby={`${id}-income-help`} /></div>
          <p id={`${id}-income-help`} className="first-plan-help">{t(locale, 'Take-home pay and other income for this month.', 'صافي راتبك وأي دخل آخر لهذا الشهر.')}</p>
        </section>
        <section className="first-plan-expenses">
          <h2>{t(locale, 'Plan your everyday expenses', 'خطط لمصروفك اليومي')}</h2>
          <p className="first-plan-help" id={`${id}-entry-help`}>{t(locale, 'Enter an amount or a %. We calculate the other.', 'أدخل مبلغًا أو نسبة مئوية. نحسب القيمة الأخرى.')}</p>
          <div className="first-plan-columns" aria-hidden="true"><span>{t(locale, 'Category', 'الفئة')}</span><span>{t(locale, 'Amount', 'المبلغ')}</span><span>{t(locale, '% of income', '٪ من الدخل')}</span></div>
          <div className="first-plan-rows">{draft.rows.map(row => {
            const suggestion = suggestions.find(item => item.id === row.id);
            const Icon = suggestion?.Icon ?? Plus;
            return <div className="first-plan-row" key={row.id}>
              <div className="first-plan-category"><Icon aria-hidden="true" />{row.custom ? <input autoFocus aria-label={t(locale, 'Category name', 'اسم الفئة')} maxLength={120} placeholder={t(locale, 'Category name', 'اسم الفئة')} value={name(row)} onChange={event => update(current => ({ ...current, rows: current.rows.map(item => item.id === row.id ? { ...item, [locale === 'ar' ? 'nameAr' : 'nameEn']: event.target.value } : item) }))} /> : <span>{name(row)}</span>}</div>
              <div className="first-plan-pair">
                <div className="first-plan-money-field" dir="ltr"><span aria-hidden="true">{symbol}</span><input aria-label={`${name(row)} ${t(locale, 'amount', 'المبلغ')}`} aria-describedby={`${id}-entry-help`} inputMode={currency === 'USD' ? 'decimal' : 'numeric'} maxLength={24} autoComplete="off" value={row.amount} placeholder={currency === 'USD' ? suggestion?.placeholder ?? '0' : '0'} onChange={event => updateRow(row.id, 'amount', event.target.value)} /></div>
                <ArrowLeftRight className="first-plan-link" aria-hidden="true" />
                <div className="first-plan-money-field first-plan-percent-field" dir="ltr"><input aria-label={`${name(row)} ${t(locale, '% of income', '٪ من الدخل')}`} aria-describedby={`${id}-entry-help`} inputMode="decimal" maxLength={6} autoComplete="off" value={row.percent} placeholder="0" disabled={!income || BigInt(income) <= 0n || pending} onChange={event => updateRow(row.id, 'percent', event.target.value)} /><span aria-hidden="true">%</span></div>
              </div>
              {row.custom ? <button type="button" className="first-plan-remove" aria-label={t(locale, 'Remove category', 'إزالة الفئة')} onClick={() => update(current => ({ ...current, rows: current.rows.filter(item => item.id !== row.id) }))}><Trash2 size={18} /></button> : null}
            </div>;
          })}</div>
          <p className="first-plan-help">{t(locale, 'Percentages use your monthly income. Example amounts are placeholders.', 'النسب تعتمد على دخلك الشهري. المبالغ الظاهرة أمثلة فقط.')}</p>
          <button type="button" className="first-plan-add" onClick={() => update(current => ({ ...current, rows: [...current.rows, { id: crypto.randomUUID(), nameEn: locale === 'en' ? '' : null, nameAr: locale === 'ar' ? '' : null, amount: '', percent: '', basis: 'amount', custom: true }] }))}><Plus size={20} aria-hidden="true" />{t(locale, 'Add a category', 'أضف فئة')}</button>
          <details className="first-plan-loans"><summary>{t(locale, 'Loan payments (optional)', 'دفعات القروض (اختياري)')}</summary><p className="first-plan-help">{t(locale, 'Add your loans after setup in Plan → Loans. Their monthly payments will appear in your plan.', 'أضف قروضك بعد الإعداد من الخطة ← القروض. ستظهر دفعاتها الشهرية في خطتك.')}</p></details>
        </section>
      </fieldset>
      <aside className="first-plan-summary" aria-label={t(locale, 'Your plan so far', 'خطتك حتى الآن')}>
        <h2>{t(locale, 'Your plan so far', 'خطتك حتى الآن')}</h2>
        <dl><div><dt>{t(locale, 'Expected income', 'الدخل المتوقع')}</dt><dd>{formatMinorAmount(income ?? '0', currency, locale)}</dd></div><div><dt>{t(locale, 'Planned expenses', 'المصروف المخطط')}</dt><dd>{formatMinorAmount(planned.toString(), currency, locale)}</dd></div></dl>
        <div aria-live="polite" aria-atomic="true" className={`first-plan-remaining${remaining < 0n ? ' first-plan-over' : ''}`} data-testid="first-plan-remaining"><strong dir="auto">{formatMinorAmount((remaining < 0n ? -remaining : remaining).toString(), currency, locale)}</strong><span>{remaining < 0n ? t(locale, 'Over your income', 'فوق دخلك') : t(locale, `${remainingPercent}% left to plan`, `${remainingPercent}٪ متبقية للتخطيط`)}</span></div>
        <progress max={100} value={Math.min(100, Number(allocated))} aria-label={t(locale, 'Income planned', 'الدخل المخطط')} />
        <p className="first-plan-help">{t(locale, `${allocated}% of your income planned`, `${allocated}٪ من دخلك مخطط`)}</p>
        <p className="first-plan-reassurance">{t(locale, 'It’s okay to leave money unplanned.', 'لا بأس بترك مبلغ دون تخطيط.')}</p><p className="first-plan-help">{t(locale, 'A plan does not move money.', 'الخطة لا تنقل الأموال.')}</p>
      </aside>
    </div>
    {error ? <div className="error-notice" role="alert">{error}</div> : null}
    <footer className="first-plan-actions">
      {onBack ? <button type="button" className="cr-button" disabled={pending} onClick={onBack}>{t(locale, 'Back', 'رجوع')}</button> : <span />}
      <button type="submit" className="cr-button cr-button--primary" disabled={pending || !clock}>{pending ? t(locale, 'Saving your plan…', 'جارٍ حفظ خطتك…') : t(locale, 'Create my plan', 'أنشئ خطتي')}<ArrowRight size={20} aria-hidden="true" /></button>
      <button type="button" className="first-plan-later" disabled={pending} onClick={finishLater}>{t(locale, 'I’ll plan later', 'سأخطط لاحقًا')}</button>
    </footer>
    {pending ? <span role="status" className="cr-visually-hidden">{t(locale, 'Saving your plan', 'جارٍ حفظ خطتك')}</span> : null}
  </form>;
}
