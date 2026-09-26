import { useEffect, useRef, useState } from 'react';
import type { Currency, CurrencySummary, Loan, Locale } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import type { BudgetCategoryRow, BudgetCurrencySummary } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

const PLAN_CURRENCIES: readonly Currency[] = ['USD', 'LBP'];

export function monthLabel(month: string, locale: Locale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(month)) return month;
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  if (Number.isNaN(date.getTime())) return month;
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
  const primary = locale === 'ar' ? row.nameAr : row.nameEn;
  const secondary = locale === 'ar' ? row.nameEn : row.nameAr;
  return primary ?? secondary ?? '';
}

function percentOf(partMinor: string, totalMinor: string): bigint | null {
  const total = BigInt(totalMinor);
  if (total <= 0n) return null;
  const part = BigInt(partMinor);
  return (part * 100n) / total;
}

export interface PlanPageProps {
  locale: Locale;
  month: string;
  summaries: readonly BudgetCurrencySummary[];
  categoryRows: readonly BudgetCategoryRow[];
  pending: boolean;
  error: string | null;
  loansSummary: readonly CurrencySummary[];
  loanRows?: readonly Loan[];
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
    await props.onSave(amountMinor);
    props.onCancel();
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
          <span className="cr-plan-edit-field">
            <input
              type="text"
              placeholder={props.currency === 'USD' ? '0.00' : '0'}
              inputMode={props.currency === 'USD' ? 'decimal' : 'numeric'}
              value={value}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? 'cr-plan-edit-error' : props.currency === 'LBP' ? 'cr-plan-lbp-hint' : undefined}
              onChange={(event) => setValue(event.target.value.replace(props.currency === 'USD' ? /[^0-9.]/g : /[^0-9]/g, ''))}
            />
            <span className="cr-plan-edit-currency">{props.currency}</span>
          </span>
        </label>
        {props.currency === 'LBP' ? (
          <small id="cr-plan-lbp-hint" className="cr-helper">
            {t(locale, 'LBP amounts are whole numbers, no decimals.', 'مبالغ الليرة مقررة بالأعداد الصحيحة دون كسور.')}
          </small>
        ) : null}
        {inputError ? (
          <div className="cr-sheet-error" role="alert" id="cr-plan-edit-error">
            <span className="cr-danger-text">{inputError}</span>
          </div>
        ) : null}
        <div className="cr-row">
          <button type="button" className="cr-button" onClick={props.onCancel}>
            {t(locale, 'Cancel', 'إلغاء')}
          </button>
          <button type="button" className="cr-button cr-button--primary" disabled={props.pending || value.trim().length === 0} onClick={() => void save()}>
            {t(locale, 'Save', 'حفظ')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlanPage(props: PlanPageProps) {
  const { locale, summaries } = props;
  const [currency, setCurrency] = useState<Currency>(() => summaries[0]?.currency ?? props.categoryRows[0]?.currency ?? 'USD');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const activeRows = props.categoryRows.filter((row) => row.archivedAt === null && row.currency === currency);
  const activeSummary = summaries.find((summary) => summary.currency === currency);
  const activeLoanSummary = props.loansSummary.find((row) => row.currency === currency);
  const activeLoans = props.loanRows?.filter((row) => row.currency === currency && row.direction === 'i_owe_them' && BigInt(row.plan.targetMinor) > 0n) ?? [];
  const commitmentMinor = activeLoanSummary?.targetMinor ?? activeSummary?.loanCommitmentMinor ?? '0';
  const repaymentMinor = activeLoanSummary?.actualRepaymentMinor ?? activeSummary?.actualLoanRepaymentMinor ?? '0';

  const summaryFor = (currency: Currency): BudgetCurrencySummary | undefined =>
    summaries.find((summary) => summary.currency === currency);

  const openEdit = (target: EditTarget) => {
    setSaveFailed(false);
    setEditTarget(target);
  };

  const editTitle = (target: EditTarget): string => target.kind === 'income'
    ? t(locale, 'Planned income', 'الدخل المخطط')
    : t(locale, `${target.name} target`, `هدف ${target.name}`);

  const failureMessage = props.error && /revision|conflict/i.test(props.error)
    ? t(locale, 'The plan changed elsewhere — refreshed, please review', 'تغيّرت الخطة من مكان آخر — تم التحديث، يرجى المراجعة')
    : t(locale, 'Could not save the plan — please try again.', 'تعذر حفظ الخطة — حاول مرة أخرى.');

  return (
    <>
      <div className="cr-tabs" role="tablist" aria-label={t(locale, 'Currency', 'العملة')}>
        {PLAN_CURRENCIES.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={currency === option}
            className={currency === option ? 'cr-tab cr-tab--active' : 'cr-tab'}
            onClick={() => setCurrency(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {saveFailed ? (
        <div className="cr-card" role="alert">
          <span className="cr-danger-text">{failureMessage}</span>
        </div>
      ) : null}
      <div className="cr-plan-summary-grid">
      {PLAN_CURRENCIES.filter((option) => option === currency).map((currency) => {
        const summary = summaryFor(currency);
        if (!summary) {
          return (
            <section key={currency} className="cr-card" aria-label={t(locale, 'Set planned income', 'حدد الدخل المخطط')}>
              <button type="button" className="cr-button cr-button--primary cr-button--block" onClick={() => openEdit({ kind: 'income', currency, currentMinor: null, expectedRevisionId: null })}>
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
              <button
                type="button"
                className="cr-button"
                aria-label={t(locale, `Edit planned income ${currency}`, `تعديل الدخل المخطط ${currency}`)}
                onClick={() => openEdit({ kind: 'income', currency, currentMinor: summary.plannedIncomeMinor, expectedRevisionId: summary.incomePlanRevisionId })}
              >
                {t(locale, 'Edit', 'تعديل')}
              </button>
            </div>
            <p className="cr-amount cr-amount--hero"><bdi>{formatMinorAmount(summary.plannedIncomeMinor, currency, locale)}</bdi></p>
            <p className="cr-helper">{t(locale, `Total expected income for ${monthLabel(props.month, locale)}.`, `إجمالي الدخل المتوقع لشهر ${monthLabel(props.month, locale)}.`)}</p>
          </section>
        );
      })}
      {summaries.filter((summary) => summary.currency === currency).map((summary) => {
        const overallocated = BigInt(summary.overallocatedMinor) !== 0n;
        const allocatedMinor = (BigInt(summary.categoryTargetTotalMinor) + BigInt(summary.loanCommitmentMinor)).toString();
        const allocatedPercent = percentOf(allocatedMinor, summary.plannedIncomeMinor);
        return (
          <section key={`allocate-${summary.currency}`} className="cr-card" aria-label={t(locale, 'Left to allocate', 'المتبقي للتخصيص') + ' ' + summary.currency}>
            <h2>
              {overallocated
                ? t(locale, 'Overallocated', 'تجاوز التخصيص')
                : t(locale, 'Left to allocate', 'المتبقي للتخصيص')}
            </h2>
            <p className={overallocated ? 'cr-amount cr-amount--hero cr-danger-text' : 'cr-amount cr-amount--hero'}>
              <bdi>{formatMinorAmount(overallocated ? summary.overallocatedMinor : summary.unallocatedMinor, summary.currency, locale)}</bdi>
            </p>
            {allocatedPercent !== null ? (
              <>
                <div className={overallocated ? 'cr-progress cr-progress--over' : 'cr-progress'} aria-hidden="true">
                  <span style={{ inlineSize: `${Number(allocatedPercent > 100n ? 100n : allocatedPercent)}%` }} />
                </div>
                <p className="cr-helper cr-plan-allocation-caption">
                  <span>{new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(allocatedPercent)}% {t(locale, 'allocated', 'مخصص')}</span>
                  <bdi>{formatMinorAmount(allocatedMinor, currency, locale)} / {formatMinorAmount(summary.plannedIncomeMinor, currency, locale)}</bdi>
                </p>
              </>
            ) : null}
          </section>
        );
      })}
      </div>
      <div className="cr-plan-detail-grid">
      <section className="cr-card" aria-label={t(locale, 'Category targets', 'أهداف الفئات')}>
        <h2>{t(locale, 'Category targets', 'أهداف الفئات')}</h2>
        <p className="cr-helper">{t(locale, 'Plan how you want to allocate your income.', 'خطط لكيفية تخصيص دخلك.')}</p>
        {activeRows.length === 0 ? (
          <p>{t(locale, 'No category targets this month.', 'لا توجد أهداف فئات هذا الشهر.')}</p>
        ) : (
          <ul aria-label={t(locale, 'Category targets', 'أهداف الفئات')}>
            {activeRows.map((row) => {
              const overspent = row.overspentMinor !== '0';
              const share = row.targetMinor !== null && activeSummary
                ? percentOf(row.targetMinor, activeSummary.plannedIncomeMinor)
                : null;
              let width: number | null = null;
              if (row.targetMinor !== null && BigInt(row.targetMinor) > 0n) {
                const raw = (BigInt(row.actualSpentMinor) * 100n) / BigInt(row.targetMinor);
                width = Number(raw > 100n ? 100n : raw);
              }
              const targetText = row.targetMinor !== null
                ? formatMinorAmount(row.targetMinor, row.currency, locale)
                : t(locale, 'No target', 'بدون هدف');
              return (
                <li key={`${row.categoryId}-${row.currency}`} className="cr-plan-category">
                  <div className="cr-row">
                    <bdi className="cr-plan-category-name">{categoryName(row, locale)}</bdi>
                    <button
                      type="button"
                      className="cr-button cr-button--sm"
                      aria-label={t(locale, `Edit ${categoryName(row, locale)} target`, `تعديل هدف ${categoryName(row, locale)}`)}
                      onClick={() => openEdit({
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
                  <div className="cr-row cr-plan-category-amounts">
                    <bdi className="cr-amount">{targetText}</bdi>
                    {share !== null ? <span className="cr-helper">{new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(share)}% {t(locale, 'of planned income', 'من الدخل المخطط')}</span> : null}
                  </div>
                  <p className={overspent ? 'cr-helper cr-warn-text' : 'cr-helper'}>
                    <bdi>{formatMinorAmount(row.actualSpentMinor, row.currency, locale)}</bdi> {t(locale, 'spent', 'مصروف')}
                  </p>
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
        <h2>{t(locale, 'Loan commitments', 'التزامات الديون')}</h2>
        <p className="cr-helper">{t(locale, 'Monthly loan payments.', 'دفعات القروض الشهرية.')}</p>
        {BigInt(commitmentMinor) === 0n ? (
          <p>{t(locale, 'No loan commitments this month.', 'لا توجد التزامات ديون هذا الشهر.')}</p>
        ) : (
          <>
            {activeLoans.length > 0 ? (
              <ul aria-label={t(locale, 'Monthly loan payments', 'دفعات القروض الشهرية')}>
                {activeLoans.map((loan) => (
                  <li key={loan.id} className="cr-journal-row cr-plan-loan-row">
                    <bdi>{loan.personName}</bdi>
                    <bdi className="cr-amount">{formatMinorAmount(loan.plan.targetMinor, currency, locale)}</bdi>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="cr-journal-row cr-plan-loan-row">
              <strong>{t(locale, 'Monthly total', 'إجمالي الشهر')}</strong>
              <bdi className="cr-amount">{formatMinorAmount(commitmentMinor, currency, locale)}</bdi>
              <small className="cr-helper"><bdi>{formatMinorAmount(repaymentMinor, currency, locale)}</bdi> {t(locale, 'paid this month', 'مسدد هذا الشهر')}</small>
            </div>
          </>
        )}
      </section>
      </div>
      {editTarget ? (
        <EditDialog
          locale={locale}
          title={editTitle(editTarget)}
          currency={editTarget.currency}
          initialValue={minorToMajorInput(editTarget.currentMinor, editTarget.currency)}
          pending={props.pending}
          onCancel={() => setEditTarget(null)}
          onSave={async (amountMinor) => {
            let ok: boolean;
            if (editTarget.kind === 'income') {
              ok = await props.onSaveIncome({
                currency: editTarget.currency,
                amountMinor,
                expectedRevisionId: editTarget.expectedRevisionId,
              });
            } else {
              ok = await props.onSaveTarget({
                categoryId: editTarget.categoryId,
                currency: editTarget.currency,
                amountMinor,
                expectedRevisionId: editTarget.expectedRevisionId,
              });
            }
            if (!ok) setSaveFailed(true);
            return ok;
          }}
        />
      ) : null}
    </>
  );
}
