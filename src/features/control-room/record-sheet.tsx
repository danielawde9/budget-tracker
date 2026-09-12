import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  HandCoins,
  Handshake,
  Undo2,
} from 'lucide-react';
import type { ExchangeDraft } from '../exchange/use-exchange.js';
import type { Currency, Locale, LoanDirection } from '../loans/types.js';
import { formatMinorAmount, parsePositiveMinorAmount } from '../wallets/money.js';
import type { WalletProjection } from '../wallets/types.js';
import { AmbiguousBanner } from './ambiguous-banner.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

type RecordKind = 'expense' | 'income' | 'transfer' | 'exchange' | 'lend' | 'borrow' | 'repay';
type Step = 'type' | 'amount' | 'wallet' | 'category' | 'details' | 'confirm';

export interface RecordCategoryNode {
  id: string;
  nameEn: string;
  nameAr: string;
  kind: 'income' | 'expense';
  children: readonly { id: string; nameEn: string; nameAr: string }[];
}

export interface OutstandingLoan {
  loanId: string;
  personName: string;
  currency: Currency;
  outstandingMinor: string;
}

export interface RecordDraft {
  kind: 'expense' | 'income' | 'transfer';
  effectiveDate: string;
  movements: readonly { walletId: string; amountMinor: string }[];
  categoryId: string | null;
  payeeName: string | null;
  note: string | null;
}

export interface LoanDraft {
  direction: LoanDirection;
  personName: string;
  currency: Currency;
  walletId: string;
  amountMinor: string;
  effectiveDate: string;
  dueDate: string | null;
  note: string | null;
}

export interface RepaymentDraft {
  loanId: string;
  walletId: string;
  amountMinor: string;
  effectiveDate: string;
}

export interface RecordSheetProps {
  open: boolean;
  locale: Locale;
  wallets: readonly WalletProjection[];
  loans: readonly OutstandingLoan[];
  payees: readonly string[];
  categoryTree: readonly RecordCategoryNode[];
  exchangeAvailable: boolean;
  pending: boolean;
  error: string | null;
  walletAmbiguous?: { requestId: string } | null;
  exchangeAmbiguous?: { requestId: string } | null;
  onRetryWalletAmbiguous?(): void;
  onDismissWalletAmbiguous?(): void;
  onRetryExchangeAmbiguous?(): void;
  onDismissExchangeAmbiguous?(): void;
  onClose(): void;
  onSubmitRecord(draft: RecordDraft): Promise<unknown>;
  onSubmitExchange(draft: ExchangeDraft): Promise<unknown>;
  onSubmitLoan(draft: LoanDraft): Promise<unknown>;
  onSubmitRepayment(draft: RepaymentDraft): Promise<unknown>;
}

const TILES: readonly { kind: RecordKind; en: string; ar: string; icon: typeof ArrowDownLeft }[] = [
  { kind: 'expense', en: 'Expense', ar: 'مصروف', icon: ArrowDownLeft },
  { kind: 'income', en: 'Income', ar: 'دخل', icon: ArrowUpRight },
  { kind: 'transfer', en: 'Transfer', ar: 'تحويل', icon: ArrowLeftRight },
  { kind: 'exchange', en: 'Exchange', ar: 'صرف', icon: Banknote },
  { kind: 'lend', en: 'Lend', ar: 'إقراض', icon: HandCoins },
  { kind: 'borrow', en: 'Borrow', ar: 'استدانة', icon: Handshake },
  { kind: 'repay', en: 'Repay', ar: 'سداد', icon: Undo2 },
];

const KIND_LABELS: Record<RecordKind, { en: string; ar: string }> = {
  expense: { en: 'Expense', ar: 'مصروف' },
  income: { en: 'Income', ar: 'دخل' },
  transfer: { en: 'Transfer', ar: 'تحويل' },
  exchange: { en: 'Exchange', ar: 'صرف' },
  lend: { en: 'Lend', ar: 'إقراض' },
  borrow: { en: 'Borrow', ar: 'استدانة' },
  repay: { en: 'Repay', ar: 'سداد' },
};

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function categoryName(node: { nameEn: string; nameAr: string }, locale: Locale): string {
  if (locale === 'ar') return node.nameAr || node.nameEn;
  return node.nameEn || node.nameAr;
}

function isCategorizedKind(kind: RecordKind): kind is 'expense' | 'income' {
  return kind === 'expense' || kind === 'income';
}

function isLoanKind(kind: RecordKind): kind is 'lend' | 'borrow' {
  return kind === 'lend' || kind === 'borrow';
}

interface KeypadProps {
  locale: Locale;
  value: string;
  onChange(next: string): void;
  onContinue(): void;
  continueDisabled: boolean;
}

function Keypad(props: KeypadProps) {
  const { locale, value, onChange } = props;
  const press = (key: string) => {
    if (key === 'back') onChange(value.slice(0, -1));
    else if (key === '.') { if (!value.includes('.')) onChange(`${value}.`); }
    else onChange(value + key);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
  return (
    <div>
      <output className="cr-record-amount" aria-label={t(locale, 'Amount', 'المبلغ')}>{value}</output>
      <div className="cr-keypad">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={key === 'back' ? t(locale, 'Delete', 'حذف') : key}
            onClick={() => press(key)}
          >
            {key === 'back' ? '⌫' : key}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="cr-button cr-button--block"
        disabled={props.continueDisabled}
        onClick={props.onContinue}
      >
        {t(locale, 'Continue', 'متابعة')}
      </button>
    </div>
  );
}

export function RecordSheet(props: RecordSheetProps) {
  const { locale } = props;
  const [kind, setKind] = useState<RecordKind | null>(null);
  const [display, setDisplay] = useState('');
  const [usdDisplay, setUsdDisplay] = useState('');
  const [lbpDisplay, setLbpDisplay] = useState('');
  const [walletId, setWalletId] = useState<string | null>(null);
  const [destWalletId, setDestWalletId] = useState<string | null>(null);
  const [loanId, setLoanId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryChosen, setCategoryChosen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [payeeName, setPayeeName] = useState('');
  const [note, setNote] = useState('');
  const [personName, setPersonName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayLocal);
  const [detailsDone, setDetailsDone] = useState(false);
  const [amountDone, setAmountDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [walletPickError, setWalletPickError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setKind(null);
    setDisplay('');
    setUsdDisplay('');
    setLbpDisplay('');
    setWalletId(null);
    setDestWalletId(null);
    setLoanId(null);
    setCategoryId(null);
    setCategoryChosen(false);
    setExpandedCategory(null);
    setPayeeName('');
    setNote('');
    setPersonName('');
    setDueDate('');
    setEffectiveDate(todayLocal());
    setDetailsDone(false);
    setAmountDone(false);
    setSubmitting(false);
    setSubmitError(null);
    setWalletPickError(null);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    sheetRef.current?.focus();
  }, [props.open]);

  const wallet = useMemo(
    () => props.wallets.find((candidate) => candidate.id === walletId) ?? null,
    [props.wallets, walletId],
  );
  const destWallet = useMemo(
    () => props.wallets.find((candidate) => candidate.id === destWalletId) ?? null,
    [props.wallets, destWalletId],
  );
  const loan = useMemo(
    () => props.loans.find((candidate) => candidate.loanId === loanId) ?? null,
    [props.loans, loanId],
  );

  const amountValid = display.trim().length > 0 && /^\d+(\.\d{1,2})?$/.test(display.trim());
  const exchangeAmountsValid =
    /^\d+(\.\d{1,2})?$/.test(usdDisplay.trim()) && /^\d+$/.test(lbpDisplay.trim());

  const step: Step = (() => {
    if (!kind) return 'type';
    if (kind === 'exchange') {
      if (!amountDone) return 'amount';
      if (!walletId || !destWalletId) return 'wallet';
      return 'confirm';
    }
    if (kind === 'repay') {
      if (!amountDone) return 'amount';
      if (!walletId) return 'wallet';
      return 'confirm';
    }
    if (!amountDone) return 'amount';
    if (!walletId || (kind === 'transfer' && !destWalletId)) return 'wallet';
    if (isCategorizedKind(kind) && !categoryChosen) return 'category';
    if ((isCategorizedKind(kind) || isLoanKind(kind)) && !detailsDone) return 'details';
    return 'confirm';
  })();

  if (!props.open) return null;

  const goBack = () => {
    setSubmitError(null);
    setWalletPickError(null);
    switch (step) {
      case 'confirm':
        if (isCategorizedKind(kind!) || isLoanKind(kind!)) setDetailsDone(false);
        else if (kind === 'repay') setWalletId(null);
        else setDestWalletId(null);
        break;
      case 'details':
        setDetailsDone(false);
        break;
      case 'category':
        setCategoryChosen(false);
        setCategoryId(null);
        break;
      case 'wallet':
        setWalletId(null);
        setDestWalletId(null);
        break;
      case 'amount':
        if (kind === 'repay') setLoanId(null);
        else setKind(null);
        setDisplay('');
        setUsdDisplay('');
        setLbpDisplay('');
        setAmountDone(false);
        break;
      case 'type':
        props.onClose();
        break;
    }
  };

  const pickWallet = (next: WalletProjection) => {
    if (!kind) return;
    setWalletPickError(null);
    if (kind === 'exchange') {
      if (next.currency === 'USD') setWalletId(next.id);
      else setDestWalletId(next.id);
      return;
    }
    try {
      parsePositiveMinorAmount(display, next.currency);
    } catch {
      setWalletPickError(t(locale, 'Enter a valid positive amount', 'أدخل مبلغًا موجبًا صالحًا'));
      return;
    }
    if (kind === 'transfer' && walletId !== null && next.id !== walletId) {
      setDestWalletId(next.id);
      return;
    }
    setWalletId(next.id);
  };

  const parseAmount = (currency: Currency): string => parsePositiveMinorAmount(display, currency);

  const buildMovements = (): readonly { walletId: string; amountMinor: string }[] => {
    if (kind === 'transfer') {
      const minor = parseAmount(wallet!.currency);
      return [
        { walletId: wallet!.id, amountMinor: `-${minor}` },
        { walletId: destWallet!.id, amountMinor: minor },
      ];
    }
    const minor = parseAmount(wallet!.currency);
    return [{ walletId: wallet!.id, amountMinor: kind === 'expense' ? `-${minor}` : minor }];
  };

  const summary = (): string => {
    const label = t(locale, KIND_LABELS[kind!].en, KIND_LABELS[kind!].ar);
    if (kind === 'exchange') {
      const usdMinor = parsePositiveMinorAmount(usdDisplay, 'USD');
      const lbpMinor = parsePositiveMinorAmount(lbpDisplay, 'LBP');
      return `${label} · ${formatMinorAmount(usdMinor, 'USD', locale)} → ${formatMinorAmount(lbpMinor, 'LBP', locale)} · ${wallet!.name} → ${destWallet!.name}`;
    }
    const minor = parseAmount(wallet!.currency);
    const amount = formatMinorAmount(minor, wallet!.currency, locale);
    if (kind === 'transfer') {
      return `${label} · ${amount} · ${wallet!.name} → ${destWallet!.name}`;
    }
    if (isLoanKind(kind!)) {
      return `${label} · ${amount} · ${wallet!.name} · ${personName.trim()}`;
    }
    if (kind === 'repay') {
      return `${label} · ${amount} · ${wallet!.name} · ${loan!.personName}`;
    }
    const category = props.categoryTree
      .flatMap((root) => [root, ...root.children])
      .find((node) => node.id === categoryId);
    const categoryLabel = category ? ` · ${categoryName(category, locale)}` : '';
    return `${label} · ${amount} · ${wallet!.name}${categoryLabel}`;
  };

  const submit = async () => {
    if (!kind || submitting || props.pending) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (kind === 'expense' || kind === 'income' || kind === 'transfer') {
        await props.onSubmitRecord({
          kind,
          effectiveDate,
          movements: buildMovements(),
          categoryId: isCategorizedKind(kind) ? categoryId : null,
          payeeName: payeeName.trim() || null,
          note: note.trim() || null,
        });
      } else if (kind === 'exchange') {
        await props.onSubmitExchange({
          usdWalletId: wallet!.id,
          lbpWalletId: destWallet!.id,
          usdAmountMinor: parsePositiveMinorAmount(usdDisplay, 'USD'),
          lbpAmountMinor: parsePositiveMinorAmount(lbpDisplay, 'LBP'),
          effectiveDate,
        });
      } else if (kind === 'lend' || kind === 'borrow') {
        await props.onSubmitLoan({
          direction: kind === 'lend' ? 'they_owe_me' : 'i_owe_them',
          personName: personName.trim(),
          currency: wallet!.currency,
          walletId: wallet!.id,
          amountMinor: parseAmount(wallet!.currency),
          effectiveDate,
          dueDate: dueDate.trim() || null,
          note: note.trim() || null,
        });
      } else {
        await props.onSubmitRepayment({
          loanId: loan!.loanId,
          walletId: wallet!.id,
          amountMinor: parseAmount(wallet!.currency),
          effectiveDate,
        });
      }
    } catch (cause) {
      setSubmitError(cause instanceof Error && cause.message.trim()
        ? cause.message
        : t(locale, 'Something went wrong. Try again.', 'حدث خطأ ما. حاول مرة أخرى.'));
    } finally {
      setSubmitting(false);
    }
  };

  const renderWalletList = (list: readonly WalletProjection[]) => (
    <ul className="cr-record-wallets">
      {list.map((candidate) => (
        <li key={candidate.id}>
          <button
            type="button"
            className="cr-record-wallet"
            aria-pressed={walletId === candidate.id || destWalletId === candidate.id}
            onClick={() => pickWallet(candidate)}
          >
            <span>{candidate.name}</span>
            {' '}
            <span>{candidate.currency}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const renderWalletStep = () => {
    if (kind === 'exchange') {
      return (
        <div>
          <h3>{t(locale, 'USD wallet', 'محفظة الدولار')}</h3>
          {renderWalletList(props.wallets.filter((candidate) => candidate.currency === 'USD'))}
          <h3>{t(locale, 'LBP wallet', 'محفظة الليرة')}</h3>
          {renderWalletList(props.wallets.filter((candidate) => candidate.currency === 'LBP'))}
        </div>
      );
    }
    if (kind === 'transfer' && walletId !== null) {
      return (
        <div>
          <h3>{t(locale, 'To', 'إلى')}</h3>
          {renderWalletList(props.wallets.filter((candidate) =>
            candidate.id !== walletId && candidate.currency === wallet!.currency))}
        </div>
      );
    }
    const list = kind === 'repay'
      ? props.wallets.filter((candidate) => candidate.currency === loan?.currency)
      : props.wallets;
    return (
      <div>
        {kind === 'transfer' ? <h3>{t(locale, 'From', 'من')}</h3> : null}
        {renderWalletList(list)}
      </div>
    );
  };

  const renderCategoryStep = () => {
    const roots = props.categoryTree.filter((root) => root.kind === kind);
    return (
      <div>
        <ul className="cr-record-categories">
          {roots.map((root) => (
            <li key={root.id}>
              <div className="cr-row">
                <button
                  type="button"
                  className="cr-record-category"
                  onClick={() => { setCategoryId(root.id); setCategoryChosen(true); }}
                >
                  {categoryName(root, locale)}
                </button>
                {root.children.length > 0 ? (
                  <button
                    type="button"
                    className="cr-button"
                    aria-label={t(locale, `Expand ${categoryName(root, locale)}`, `عرض ${categoryName(root, locale)}`)}
                    aria-expanded={expandedCategory === root.id}
                    onClick={() => setExpandedCategory(expandedCategory === root.id ? null : root.id)}
                  >
                    {expandedCategory === root.id ? '−' : '+'}
                  </button>
                ) : null}
              </div>
              {expandedCategory === root.id ? (
                <ul className="cr-record-subcategories">
                  {root.children.map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className="cr-record-category"
                        onClick={() => { setCategoryId(child.id); setCategoryChosen(true); }}
                      >
                        {categoryName(child, locale)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="cr-button cr-button--block"
          onClick={() => { setCategoryId(null); setCategoryChosen(true); }}
        >
          {t(locale, 'Skip', 'تخطَّ')}
        </button>
      </div>
    );
  };

  const renderDetailsStep = () => (
    <div className="cr-record-details">
      <label className="cr-label">
        {t(locale, 'Date', 'التاريخ')}
        <input
          type="date"
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
        />
      </label>
      {isLoanKind(kind!) ? (
        <label className="cr-label">
          {t(locale, 'Person', 'الشخص')}
          <input
            type="text"
            value={personName}
            onChange={(event) => setPersonName(event.target.value)}
          />
        </label>
      ) : (
        <label className="cr-label">
          {t(locale, 'Payee', 'المستفيد')}
          <input
            type="text"
            list="cr-payee-list"
            value={payeeName}
            onChange={(event) => setPayeeName(event.target.value)}
          />
        </label>
      )}
      {isLoanKind(kind!) ? (
        <label className="cr-label">
          {t(locale, 'Due date (optional)', 'تاريخ الاستحقاق (اختياري)')}
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>
      ) : null}
      <label className="cr-label">
        {t(locale, 'Note', 'ملاحظة')}
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <datalist id="cr-payee-list">
        {props.payees.map((payee) => <option key={payee} value={payee}>{payee}</option>)}
      </datalist>
      <button
        type="button"
        className="cr-button cr-button--block"
        disabled={isLoanKind(kind!) && !personName.trim()}
        onClick={() => setDetailsDone(true)}
      >
        {t(locale, 'Continue', 'متابعة')}
      </button>
    </div>
  );

  const renderStep = () => {
    switch (step) {
      case 'type':
        return (
          <div className="cr-type-grid" role="group" aria-label={t(locale, 'Record type', 'نوع القيد')}>
            {TILES.map((tile) => {
              const Icon = tile.icon;
              const disabled = tile.kind === 'exchange' && !props.exchangeAvailable;
              return (
                <button
                  key={tile.kind}
                  type="button"
                  className="cr-type-tile"
                  disabled={disabled}
                  title={disabled
                    ? t(locale, 'Connect this browser to its data service to record exchanges.', 'اربط هذا المتصفح بخدمة البيانات لتسجيل الصرافة.')
                    : undefined}
                  onClick={() => setKind(tile.kind)}
                >
                  <Icon size={20} aria-hidden="true" />
                  {t(locale, tile.en, tile.ar)}
                </button>
              );
            })}
          </div>
        );
      case 'amount':
        if (kind === 'exchange') {
          return (
            <div className="cr-record-details">
              <label className="cr-label">
                {t(locale, 'USD out', 'دولار صادر')}
                <input
                  type="text"
                  inputMode="decimal"
                  value={usdDisplay}
                  onChange={(event) => setUsdDisplay(event.target.value.replace(/[^0-9.]/g, ''))}
                />
              </label>
              <label className="cr-label">
                {t(locale, 'LBP in', 'ليرة واردة')}
                <input
                  type="text"
                  inputMode="numeric"
                  value={lbpDisplay}
                  onChange={(event) => setLbpDisplay(event.target.value.replace(/[^0-9]/g, ''))}
                />
              </label>
              <button
                type="button"
                className="cr-button cr-button--block"
                disabled={!exchangeAmountsValid}
                onClick={() => setAmountDone(true)}
              >
                {t(locale, 'Continue', 'متابعة')}
              </button>
            </div>
          );
        }
        if (kind === 'repay' && loanId === null) {
          return (
            <ul className="cr-record-wallets">
              {props.loans.map((candidate) => (
                <li key={candidate.loanId}>
                  <button
                    type="button"
                    className="cr-record-wallet"
                    onClick={() => setLoanId(candidate.loanId)}
                  >
                    <span>{candidate.personName}</span>
                    {' '}
                    <span>{formatMinorAmount(candidate.outstandingMinor, candidate.currency, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <Keypad
            locale={locale}
            value={display}
            onChange={setDisplay}
            onContinue={() => setAmountDone(true)}
            continueDisabled={!amountValid}
          />
        );
      case 'wallet':
        return renderWalletStep();
      case 'category':
        return renderCategoryStep();
      case 'details':
        return renderDetailsStep();
      case 'confirm':
        return (
          <div>
            <p className="cr-record-summary">{summary()}</p>
            {submitError ? (
              <div className="cr-sheet-error" role="alert">
                <span className="cr-danger-text">{submitError}</span>
              </div>
            ) : null}
            <button
              type="button"
              className="cr-button cr-button--block"
              disabled={props.pending || submitting}
              onClick={() => void submit()}
            >
              {t(locale, 'Confirm', 'تأكيد')}
            </button>
          </div>
        );
    }
  };

  const stepTitle = (() => {
    switch (step) {
      case 'type': return t(locale, 'Record', 'سجّل');
      case 'amount':
        if (kind === 'repay' && loanId === null) return t(locale, 'Choose a loan', 'اختر دينًا');
        return t(locale, 'Amount', 'المبلغ');
      case 'wallet': return t(locale, 'Wallet', 'المحفظة');
      case 'category': return t(locale, 'Category', 'الفئة');
      case 'details': return t(locale, 'Details', 'التفاصيل');
      case 'confirm': return t(locale, 'Confirm', 'تأكيد');
    }
  })();

  return (
    <div className="cr-sheet-backdrop" onClick={props.onClose}>
      <div
        ref={sheetRef}
        className="cr-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'Record', 'تسجيل')}
        tabIndex={-1}
        onClick={(click) => click.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape') props.onClose(); }}
      >
        <div className="cr-row">
          {step !== 'type' ? (
            <button type="button" className="cr-button" onClick={goBack}>
              {t(locale, 'Back', 'رجوع')}
            </button>
          ) : null}
          <h2>{stepTitle}</h2>
        </div>
        {props.error ? (
          <div className="cr-sheet-error" role="alert">
            <span className="cr-danger-text">{props.error}</span>
          </div>
        ) : null}
        {renderStep()}
        {walletPickError ? (
          <div className="cr-sheet-error" role="alert">
            <span className="cr-danger-text">{walletPickError}</span>
          </div>
        ) : null}
        {props.walletAmbiguous && props.onRetryWalletAmbiguous && props.onDismissWalletAmbiguous ? (
          <AmbiguousBanner
            locale={locale}
            ambiguous={props.walletAmbiguous}
            onRetry={props.onRetryWalletAmbiguous}
            onDismiss={props.onDismissWalletAmbiguous}
          />
        ) : null}
        {props.exchangeAmbiguous && props.onRetryExchangeAmbiguous && props.onDismissExchangeAmbiguous ? (
          <AmbiguousBanner
            locale={locale}
            ambiguous={props.exchangeAmbiguous}
            onRetry={props.onRetryExchangeAmbiguous}
            onDismiss={props.onDismissExchangeAmbiguous}
          />
        ) : null}
      </div>
    </div>
  );
}
