import { useRef, useState, type FormEvent } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { minorToMajorText } from '../allocation/money-allocation.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { parsePositiveMinorAmount } from '../wallets/money.js';
import { classifyGoalsError, localizeGoalsError } from './errors.js';
import {
  runBuyIt,
  type BuyItCommands,
  type BuyItOutcome,
  type BuyItRequest,
  type BuyItRequestIds,
  type BuyItStep,
} from './buy-it.js';
import type { GoalDefinitionInput, GoalMilestoneInput, GoalSummary } from './types.js';

interface WalletOption {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
}

interface CategoryOption {
  readonly id: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
}

export interface GoalBuyItDialogProps {
  readonly locale: Locale;
  readonly currency: Currency;
  readonly goal: GoalSummary;
  readonly goalHead: string;
  /** The space-clock "today" (`YYYY-MM-DD`); the record date is capped to it. */
  readonly today: string;
  /** The revise input the close step sends, reconstructed from the detail. */
  readonly revision: { expectedRevisionId: string; definition: GoalDefinitionInput; milestones: readonly GoalMilestoneInput[] };
  readonly walletOptions: readonly WalletOption[];
  readonly categoryOptions: readonly CategoryOption[];
  readonly commands: BuyItCommands;
  onClose(): void;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function goalName(locale: Locale, goal: GoalSummary): string | null {
  return locale === 'ar' ? (goal.nameAr ?? goal.nameEn) : (goal.nameEn ?? goal.nameAr);
}

function newRequestIds(): BuyItRequestIds {
  return {
    record: globalThis.crypto.randomUUID(),
    link: globalThis.crypto.randomUUID(),
    close: globalThis.crypto.randomUUID(),
  };
}

type Phase = 'form' | 'running' | 'result';

function stepTitle(locale: Locale, step: 'record' | 'link' | 'close'): string {
  if (step === 'record') return t(locale, 'Expense recorded', 'تم تسجيل المصروف');
  if (step === 'link') return t(locale, 'Purchase linked', 'تم ربط الشراء');
  return t(locale, 'Goal closed', 'تم إغلاق الهدف');
}

function stepStatusText(locale: Locale, step: BuyItStep): string {
  switch (step.status) {
    case 'success': return step.reconciled
      ? t(locale, 'done (confirmed after an uncertain result)', 'تم (تأكد بعد نتيجة غير مؤكدة)')
      : t(locale, 'done', 'تم');
    case 'ambiguous': return t(locale, 'still unknown', 'غير معروف بعد');
    case 'failed': return t(locale, 'not done', 'لم يتم');
    case 'not-attempted': return t(locale, 'not attempted', 'لم تُجرَّ بعد');
  }
}

function failedDetail(locale: Locale, step: BuyItStep): string | null {
  if (step.status !== 'failed') return null;
  const view = localizeGoalsError(classifyGoalsError({ message: step.message ?? '' }), locale);
  return `${view.message} ${view.recovery}`;
}

/** An honest, step-by-step account of what happened and, when a later step
 * failed or is still unknown, exactly what remains (the money already posted
 * is never reversed or hidden). */
function remaining(locale: Locale, outcome: BuyItOutcome): string | null {
  const missing: string[] = [];
  if (outcome.record.status !== 'success') missing.push(t(locale, 'record the expense', 'تسجيل المصروف'));
  else if (outcome.link.status !== 'success') {
    missing.push(t(locale, 'link the expense to the goal', 'ربط المصروف بالهدف'));
    missing.push(t(locale, 'close the goal', 'إغلاق الهدف'));
  } else if (outcome.close.status !== 'success') {
    missing.push(t(locale, 'close the goal', 'إغلاق الهدف'));
  }
  if (missing.length === 0) return null;
  return `${t(locale, 'What remains', 'ما تبقّى')}: ${missing.join(t(locale, ', ', '، '))}.`;
}

export function GoalBuyItDialog(props: GoalBuyItDialogProps) {
  const { locale, currency, goal } = props;
  const [amountText, setAmountText] = useState(() => minorToMajorText(goal.targetMinor, currency));
  const [walletId, setWalletId] = useState(() => props.walletOptions[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(() => props.categoryOptions[0]?.id ?? '');
  const [effectiveDate, setEffectiveDate] = useState(props.today);
  const [phase, setPhase] = useState<Phase>('form');
  const [outcome, setOutcome] = useState<BuyItOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fixed, caller-owned request ids for this one purchase attempt: generated
  // once and reused on every retry, so an uncertain transport result can never
  // double-post or double-link. The request itself is frozen at first submit.
  const requestIds = useRef<BuyItRequestIds | null>(null);
  const frozenRequest = useRef<BuyItRequest | null>(null);

  const name = goalName(locale, goal);

  async function execute() {
    const request = frozenRequest.current;
    if (!request) return;
    const ids = requestIds.current ?? (requestIds.current = newRequestIds());
    setPhase('running');
    setError(null);
    try {
      const result = await runBuyIt(props.commands, request, ids);
      setOutcome(result);
    } catch (cause) {
      const view = localizeGoalsError(classifyGoalsError(cause), locale);
      setError(`${view.message} ${view.recovery}`);
    } finally {
      setPhase('result');
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const wallet = props.walletOptions.find((candidate) => candidate.id === walletId);
    if (!wallet) {
      setError(t(locale, 'Choose the wallet this purchase was paid from.', 'اختر المحفظة التي دُفع منها هذا الشراء.'));
      return;
    }
    if (!categoryId) {
      setError(t(locale, 'Choose a category for this expense.', 'اختر فئة لهذا المصروف.'));
      return;
    }
    if (!effectiveDate) {
      setError(t(locale, 'Choose a date.', 'اختر تاريخًا.'));
      return;
    }
    if (effectiveDate > props.today) {
      setError(t(locale, 'Choose a date today or earlier.', 'اختر تاريخًا اليوم أو في تاريخ أقدم.'));
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parsePositiveMinorAmount(amountText, currency);
    } catch {
      setError(t(locale, 'Enter a valid positive amount.', 'أدخل مبلغًا موجبًا صالحًا.'));
      return;
    }
    frozenRequest.current = {
      goalId: goal.id,
      expectedHead: props.goalHead,
      expectedRevisionId: props.revision.expectedRevisionId,
      definition: props.revision.definition,
      milestones: props.revision.milestones,
      walletId: wallet.id,
      categoryId,
      amountMinor,
      effectiveDate,
    };
    void execute();
  }

  const success = outcome !== null
    && outcome.record.status === 'success'
    && outcome.link.status === 'success'
    && outcome.close.status === 'success';

  if (phase === 'result' && outcome && success) {
    return <DialogShell title={t(locale, 'Buy it', 'اشترِه')} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={props.onClose} descriptionId="buy-it-result" focusVersion="done">
      <div className="dialog-result" role="status">
        <strong>{t(locale, 'Purchase complete', 'تم الشراء')}</strong>
        <p id="buy-it-result">
          {t(locale, 'The expense was recorded, linked to the goal, and the goal was closed.', 'تم تسجيل المصروف وربطه بالهدف وإغلاق الهدف.')}
        </p>
        <ul className="goal-buyit-steps">
          <li>{stepTitle(locale, 'record')} — {stepStatusText(locale, outcome.record)}</li>
          <li>{stepTitle(locale, 'link')} — {stepStatusText(locale, outcome.link)}</li>
          <li>{stepTitle(locale, 'close')} — {stepStatusText(locale, outcome.close)}</li>
        </ul>
        <button type="button" data-autofocus onClick={props.onClose}>{t(locale, 'Done', 'تم')}</button>
      </div>
    </DialogShell>;
  }

  const busy = phase === 'running';
  const ambiguous = outcome !== null && [outcome.record, outcome.link, outcome.close].some((step) => step.status === 'ambiguous');
  const failed = outcome !== null && [outcome.record, outcome.link, outcome.close].some((step) => step.status === 'failed');
  const failureDetail = outcome
    ? failedDetail(locale, outcome.record) ?? failedDetail(locale, outcome.link) ?? failedDetail(locale, outcome.close)
    : null;
  const remainingText = outcome && !ambiguous ? remaining(locale, outcome) : null;
  const moneyPosted = outcome !== null && outcome.record.status === 'success';

  return <DialogShell title={t(locale, 'Buy it', 'اشترِه')} closeLabel={t(locale, 'Close', 'إغلاق')} onClose={props.onClose} pending={busy}
    descriptionId="buy-it-intro" focusVersion={phase}>
    <form onSubmit={submit}>
      <p id="buy-it-intro" className="dialog-intro">
        {t(locale, 'Records the purchase as a categorized expense, links it to', 'يسجّل الشراء كمصروف مُصنّف، ويربطه بـ')}
        {' '}<bdi>{name ?? t(locale, 'this goal', 'هذا الهدف')}</bdi>{' '}
        {t(locale, 'and closes the goal — in one step.', 'ويغلق الهدف — في خطوة واحدة.')}
      </p>

      <label className="full-field">
        {t(locale, 'Amount', 'المبلغ')}
        <input data-autofocus type="text" inputMode="decimal" placeholder={currency === 'USD' ? '0.00' : '0'} value={amountText}
          disabled={busy || outcome !== null}
          onChange={(event) => { setAmountText(event.target.value); setError(null); }} />
      </label>

      <label className="full-field">
        {t(locale, 'Wallet', 'المحفظة')}
        <select value={walletId} disabled={busy || outcome !== null} onChange={(event) => { setWalletId(event.target.value); setError(null); }}>
          {props.walletOptions.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
        </select>
      </label>

      <label className="full-field">
        {t(locale, 'Category', 'الفئة')}
        <select value={categoryId} disabled={busy || outcome !== null} onChange={(event) => { setCategoryId(event.target.value); setError(null); }}>
          {props.categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {(locale === 'ar' ? (category.nameAr ?? category.nameEn) : (category.nameEn ?? category.nameAr)) ?? category.id}
            </option>
          ))}
        </select>
      </label>

      <label className="full-field">
        {t(locale, 'Date', 'التاريخ')}
        <input type="date" max={props.today} value={effectiveDate} disabled={busy || outcome !== null}
          onChange={(event) => { setEffectiveDate(event.target.value); setError(null); }} />
      </label>

      {error && <div className="error-notice" role="alert">{error}</div>}

      {outcome && <div className="error-notice" role={ambiguous ? 'alert' : 'status'}>
        <ul className="goal-buyit-steps">
          <li>{stepTitle(locale, 'record')} — {stepStatusText(locale, outcome.record)}</li>
          <li>{stepTitle(locale, 'link')} — {stepStatusText(locale, outcome.link)}</li>
          <li>{stepTitle(locale, 'close')} — {stepStatusText(locale, outcome.close)}</li>
        </ul>
        {ambiguous && <p>{t(locale, 'The result of the last step is still unknown. Retry only with this unchanged request.', 'ما زالت نتيجة الخطوة الأخيرة غير معروفة. أعد المحاولة بهذا الطلب نفسه فقط.')}</p>}
        {failed && moneyPosted && <p>{t(locale, 'The money is already posted, so it is not reversed. Fix the blocker, then finish the remaining steps.', 'تم ترحيل المال بالفعل، لذا لا يُعكَس. أصلح ما يمنع الإكمال ثم أكمل الخطوات المتبقية.')}</p>}
        {failureDetail && <p>{failureDetail}</p>}
        {remainingText && <p>{remainingText}</p>}
      </div>}

      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={busy} onClick={props.onClose}>
          {outcome ? t(locale, 'Close', 'إغلاق') : t(locale, 'Cancel', 'إلغاء')}
        </button>
        {outcome === null
          ? <button type="submit" className="cr-button cr-button--primary" disabled={busy}>
            {busy ? t(locale, 'Buying…', 'جارٍ الشراء…') : t(locale, 'Buy it', 'اشترِه')}
          </button>
          : ambiguous
            ? <button type="button" className="cr-button cr-button--primary" disabled={busy} onClick={() => void execute()}>
              {busy ? t(locale, 'Checking…', 'جارٍ التحقق…') : t(locale, 'Retry unchanged request', 'إعادة الطلب دون تغيير')}
            </button>
            : <button type="button" className="cr-button cr-button--primary" onClick={props.onClose}>{t(locale, 'Done', 'تم')}</button>}
      </div>
    </form>
  </DialogShell>;
}
