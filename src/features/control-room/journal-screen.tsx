import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import type { JournalEvent, JournalEventKind } from '../wallets/types.js';
import { KIND_LABELS, eventLabel } from './home-screen.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

type KindFilter = 'all' | JournalEventKind | 'exchange' | 'loans';

const LOAN_KINDS: readonly JournalEventKind[] = [
  'loan_opening',
  'loan_lend',
  'loan_borrow',
  'loan_receive_repayment',
  'loan_repay_borrowing',
];

function isMultiCurrency(event: JournalEvent): boolean {
  const currencies = new Set(event.movements.map((movement) => movement.currency));
  return currencies.size > 1;
}

function matchesFilter(event: JournalEvent, filter: KindFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'loans') return LOAN_KINDS.includes(event.kind);
  if (filter === 'exchange') return isMultiCurrency(event);
  if (filter === 'transfer') return event.kind === 'transfer' && !isMultiCurrency(event);
  return event.kind === filter;
}

const FILTER_CHIPS: readonly { filter: KindFilter; en: string; ar: string }[] = [
  { filter: 'all', en: 'All', ar: 'الكل' },
  { filter: 'income', en: 'Income', ar: 'دخل' },
  { filter: 'expense', en: 'Expense', ar: 'مصروف' },
  { filter: 'transfer', en: 'Transfer', ar: 'تحويل' },
  { filter: 'exchange', en: 'Exchange', ar: 'صرف' },
  { filter: 'loans', en: 'Loans', ar: 'الديون' },
];

function rowLabel(event: JournalEvent, locale: Locale): string {
  if (event.reversalOf !== null) {
    return t(locale, `Reversal of ${event.reversalOf}`, `عكس قيد ${event.reversalOf}`);
  }
  return eventLabel(event, locale);
}

export interface JournalScreenProps {
  locale: Locale;
  events: readonly JournalEvent[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore(): void;
  onReverse(eventId: string): Promise<unknown>;
  reversePending: boolean;
}

export function JournalScreen(props: JournalScreenProps) {
  const { locale } = props;
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [selected, setSelected] = useState<JournalEvent | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null);
        openerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const closeSheet = () => {
    setSelected(null);
    openerRef.current?.focus();
  };

  const visibleEvents = props.events.filter((event) => matchesFilter(event, kindFilter));
  const selectedReversible = selected !== null && selected.reversalOf === null && selected.reversedBy === null;

  return (
    <>
      <header className="cr-row">
        <h1>{t(locale, 'Journal', 'القيود')}</h1>
      </header>
      <div className="cr-chips" role="group" aria-label={t(locale, 'Filter by type', 'تصفية حسب النوع')}>
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.filter}
            type="button"
            className={kindFilter === chip.filter ? 'cr-chip cr-chip--active' : 'cr-chip'}
            aria-pressed={kindFilter === chip.filter}
            onClick={() => setKindFilter(chip.filter)}
          >
            {t(locale, chip.en, chip.ar)}
          </button>
        ))}
      </div>
      <section className="cr-card" aria-label={t(locale, 'Journal entries', 'قيود اليومية')}>
        {visibleEvents.length === 0 ? (
          <p>{t(locale, 'No journal entries yet.', 'لا توجد قيود بعد.')}</p>
        ) : visibleEvents.map((event) => {
          const label = rowLabel(event, locale);
          const reversal = event.reversalOf !== null;
          return (
            <button
              key={event.id}
              type="button"
              className="cr-journal-row cr-journal-row--button"
              onClick={(click) => {
                openerRef.current = click.currentTarget;
                setSelected(event);
              }}
            >
              <span>{label}</span>
              <span>
                {event.movements.map((movement) => {
                  const positive = event.kind === 'income' && BigInt(movement.amountMinor) > 0n;
                  const className = reversal
                    ? 'cr-reversal-text'
                    : positive
                      ? 'cr-positive'
                      : undefined;
                  return (
                    <span key={`${event.id}-${movement.walletId}-${movement.currency}`} className={className}>
                      {formatMinorAmount(movement.amountMinor, movement.currency, locale)}
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
      </section>
      {props.nextCursor !== null ? (
        <button
          type="button"
          className="cr-button cr-button--block"
          disabled={props.loadingMore}
          onClick={props.onLoadMore}
        >
          {t(locale, 'Load more', 'تحميل المزيد')}
        </button>
      ) : null}
      {selected ? (
        <div className="cr-sheet-backdrop" onClick={closeSheet}>
          <div
            className="cr-sheet"
            role="dialog"
            aria-label={rowLabel(selected, locale)}
            onClick={(click) => click.stopPropagation()}
          >
            <h2>{rowLabel(selected, locale)}</h2>
            <p className="cr-label">
              {t(locale, KIND_LABELS[selected.kind].en, KIND_LABELS[selected.kind].ar)}
              {' · '}
              {selected.effectiveDate}
            </p>
            {selected.note?.trim() ? <p>{selected.note.trim()}</p> : null}
            <ul className="cr-movements">
              {selected.movements.map((movement) => (
                <li key={`${movement.walletId}-${movement.currency}`}>
                  <span>
                    {movement.walletName}
                    {movement.walletArchived ? ` ${t(locale, '(archived)', '(مؤرشفة)')}` : ''}
                  </span>
                  <span className={selected.reversalOf !== null ? 'cr-reversal-text' : 'cr-amount'}>
                    {formatMinorAmount(movement.amountMinor, movement.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
            {selected.reversedBy !== null ? (
              <p className="cr-label">
                {t(locale, `Reversed by reversal ${selected.reversedBy}`, `عُكست بواسطة القيد ${selected.reversedBy}`)}
              </p>
            ) : null}
            {selected.reversalOf !== null ? (
              <p className="cr-label">
                {t(locale, `Reversal of ${selected.reversalOf}`, `عكس القيد ${selected.reversalOf}`)}
              </p>
            ) : null}
            <button
              type="button"
              className="cr-button cr-button--danger cr-button--block"
              disabled={!selectedReversible || props.reversePending}
              onClick={() => void props.onReverse(selected.id)}
            >
              {t(locale, 'Reverse', 'اعكس القيد')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
