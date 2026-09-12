import { useEffect, useRef, useState } from 'react';
import type { Currency, CurrencySummary, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import type { BudgetCategoryRow, BudgetCurrencySummary } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

const PLAN_CURRENCIES: readonly Currency[] = ['USD', 'LBP'];

function monthLabel(month: string, locale: Locale): string {
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { month: 'long', year: 'numeric' }).format(date);
}

function minorToMajorInput(amountMinor: string | null, currency: Currency): string {
  if (amountMinor === null) return '';
  const amount = BigInt(amountMinor);
  if (currency === 'LBP') return amount.toString();
  const whole = amount / 100n;
  const fraction = (amount % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

function categoryName(row: BudgetCategoryRow, locale: Locale): string {
  return locale === 'ar' ? row.nameAr : row.nameEn;
}

export interface PlanPageProps {
  locale: Locale;
  month: string;
  summaries: readonly BudgetCurrencySummary[];
  categoryRows: readonly BudgetCategoryRow[];
  pending: boolean;
  error: string | null;
  loansSummary: readonly CurrencySummary[];
  onSaveIncome(input: { currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
  onSaveTarget(input: { categoryId: string; currency: Currency; amountMinor: string; expectedRevisionId: string | null }): Promise<boolean>;
}

type EditTarget =
  | { kind: 'income'; currency: Currency; currentMinor: string | null; expectedRevisionId: string | null }
  | { kind: 'target'; categoryId: string; currency: Currency; currentMinor: string | null; expectedRevisionId: string | null; name: string };

interface EditDialogProps {
  locale: Locale;
  title: string;
  currency: Currency;
  initialValue: string;
  pending: boolean;
  onCancel(): void;
  onSave(amountMinor: string): Promise<boolean>;
}

function EditDialog(props: EditDialogProps) {
  const { locale } = props;
  const [value, setValue] = useState(props.initialValue);
  const [inputError, setInputError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    return () => { openerRef.current?.focus(); };
  }, []);

  const save = async () => {
    let amountMinor: string;
    try {
      amountMinor = parsePositiveMinorAmount(value, props.currency);
    } catch {
      setInputError(t(locale, 'Enter a valid positive amount', 'أدخل مبلغًا موجبًا صالحًا'));
      return;
    }
    setInputError(null);
    setConflict(false);
    if (await props.onSave(amountMinor)) {
      props.onCancel();
    } else {
      setConflict(true);
    }
  };

  return (
    <div className="cr-sheet-backdrop" onClick={props.onCancel}>
      <div
        ref={sheetRef}
        className="cr-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        onClick={(click) => click.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape') props.onCancel(); }}
      >
        <h2>{props.title}</h2>
        <label className="cr-label">
          {t(locale, 'Amount', 'المبلغ')}
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(props.currency === 'USD' ? /[^0-9.]/g : /[^0-9]/g, ''))}
          />
        </label>
        <span className="cr-label">{props.currency}</span>
        {inputError ? (
          <div className="cr-sheet-error" role="alert">
            <span className="cr-danger-text">{inputError}</span>
          </div>
        ) : null}
        {conflict ? (
          <div className="cr-sheet-error" role="alert">
            <span className="cr-danger-text">
              {t(locale, 'The plan changed elsewhere — refreshed, please review', 'تغيّرت الخطة من مكان آخر — تم التحديث، يرجى المراجعة')}
            </span>
          </div>
        ) : null}
        <div className="cr-row">
          <button type="button" className="cr-button" onClick={props.onCancel}>
            {t(locale, 'Cancel', 'إلغاء')}
          </button>
          <button type="button" className="cr-button" disabled={props.pending || value.trim().length === 0} onClick={() => void save()}>
            {t(locale, 'Save', 'حفظ')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlanPage(props: PlanPageProps) {
  const { locale, month, summaries } = props;
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const activeRows = props.categoryRows.filter((row) => row.archivedAt === null);

  const summaryFor = (currency: Currency): BudgetCurrencySummary | undefined =>
    summaries.find((summary) => summary.currency === currency);

  const editTitle = (target: EditTarget): string => target.kind === 'income'
    ? t(locale, 'Planned income', 'الدخل المخطط')
    : t(locale, `${target.name} target`, `هدف ${target.name}`);

  return (
    <>
      <header className="cr-row">
        <h1>{t(locale, 'Monthly plan', 'الخطة الشهرية')}</h1>
        <span className="cr-label">{monthLabel(month, locale)}</span>
      </header>
      {props.error ? (
        <div className="cr-card" role="alert">
          <span className="cr-danger-text">{props.error}</span>
        </div>
      ) : null}
      {PLAN_CURRENCIES.map((currency) => {
        const summary = summaryFor(currency);
        if (!summary) {
          return (
            <section key={currency} className="cr-card" aria-label={t(locale, 'Set planned income', 'حدد الدخل المخطط')}>
              <button type="button" className="cr-button" onClick={() => setEditTarget({ kind: 'income', currency, currentMinor: null, expectedRevisionId: null })}>
                {t(locale, 'Set planned income', 'حدد الدخل المخطط')}
                {' '}
                <span className="cr-chip">{currency}</span>
              </button>
            </section>
          );
        }
        return (
          <section key={currency} className="cr-card" aria-label={t(locale, 'Planned income', 'الدخل المخطط') + ' ' + currency}>
            <div className="cr-row">
              <h2 className="cr-label">{t(locale, 'Planned income', 'الدخل المخطط')}</h2>
              <button type="button" className="cr-button" onClick={() => setEditTarget({ kind: 'income', currency, currentMinor: summary.plannedIncomeMinor, expectedRevisionId: summary.incomePlanRevisionId })}>
                {t(locale, 'Edit', 'تعديل')}
              </button>
            </div>
            <p className="cr-amount">{formatMinorAmount(summary.plannedIncomeMinor, currency, locale)}</p>
          </section>
        );
      })}
      {summaries.map((summary) => {
        const overallocated = BigInt(summary.overallocatedMinor) !== 0n;
        return (
          <section key={`allocate-${summary.currency}`} className="cr-card" aria-label={t(locale, 'Left to allocate', 'المتبقي للتخصيص') + ' ' + summary.currency}>
            <h2 className="cr-label">
              {overallocated
                ? t(locale, 'Overallocated', 'تجاوز التخصيص')
                : t(locale, 'Left to allocate', 'المتبقي للتخصيص')}
            </h2>
            <p className={overallocated ? 'cr-amount cr-danger-text' : 'cr-amount'}>
              {formatMinorAmount(overallocated ? summary.overallocatedMinor : summary.unallocatedMinor, summary.currency, locale)}
            </p>
          </section>
        );
      })}
      <section className="cr-card" aria-label={t(locale, 'Category targets', 'أهداف الفئات')}>
        <h2 className="cr-label">{t(locale, 'Category targets', 'أهداف الفئات')}</h2>
        {activeRows.length === 0 ? (
          <p>{t(locale, 'No category targets this month.', 'لا توجد أهداف فئات هذا الشهر.')}</p>
        ) : (
          <ul aria-label={t(locale, 'Category targets', 'أهداف الفئات')}>
            {activeRows.map((row) => {
              const overspent = row.overspentMinor !== '0';
              let width: number | null = null;
              if (row.targetMinor !== null && BigInt(row.targetMinor) > 0n) {
                const raw = (BigInt(row.actualSpentMinor) * 100n) / BigInt(row.targetMinor);
                width = Number(raw > 100n ? 100n : raw);
              }
              return (
                <li key={`${row.categoryId}-${row.currency}`}>
                  <div className="cr-row">
                    <span>{categoryName(row, locale)}</span>
                    <button
                      type="button"
                      className="cr-button"
                      onClick={() => setEditTarget({
                        kind: 'target',
                        categoryId: row.categoryId,
                        currency: row.currency,
                        currentMinor: row.targetMinor,
                        expectedRevisionId: row.targetRevisionId,
                        name: categoryName(row, locale),
                      })}
                    >
                      {t(locale, 'Edit', 'تعديل')}
                    </button>
                  </div>
                  <div className="cr-row" style={{ fontSize: 13 }}>
                    <span className={overspent ? 'cr-warn-text' : undefined}>
                      {formatMinorAmount(row.actualSpentMinor, row.currency, locale)}
                    </span>
                    <span className="cr-label">
                      {row.targetMinor !== null ? formatMinorAmount(row.targetMinor, row.currency, locale) : t(locale, 'No target', 'بدون هدف')}
                    </span>
                  </div>
                  {width !== null ? (
                    <div className={overspent ? 'cr-progress cr-progress--over' : 'cr-progress'} aria-hidden="true">
                      <span style={{ inlineSize: `${width}%` }} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="cr-card" aria-label={t(locale, 'Loan commitments', 'التزامات الديون')}>
        <h2 className="cr-label">{t(locale, 'Loan commitments', 'التزامات الديون')}</h2>
        {props.loansSummary.length === 0 ? (
          <p>{t(locale, 'No loan commitments this month.', 'لا توجد التزامات ديون هذا الشهر.')}</p>
        ) : props.loansSummary.map((row) => (
          <div key={row.currency} className="cr-journal-row">
            <span className="cr-chip">{row.currency}</span>
            <span className="cr-amount">{formatMinorAmount(row.targetMinor, row.currency, locale)}</span>
          </div>
        ))}
      </section>
      {editTarget ? (
        <EditDialog
          locale={locale}
          title={editTitle(editTarget)}
          currency={editTarget.currency}
          initialValue={minorToMajorInput(editTarget.currentMinor, editTarget.currency)}
          pending={props.pending}
          onCancel={() => setEditTarget(null)}
          onSave={async (amountMinor) => {
            if (editTarget.kind === 'income') {
              return props.onSaveIncome({
                currency: editTarget.currency,
                amountMinor,
                expectedRevisionId: editTarget.expectedRevisionId,
              });
            }
            return props.onSaveTarget({
              categoryId: editTarget.categoryId,
              currency: editTarget.currency,
              amountMinor,
              expectedRevisionId: editTarget.expectedRevisionId,
            });
          }}
        />
      ) : null}
    </>
  );
}
