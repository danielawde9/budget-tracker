import { CommandScope, useCommandScope } from '../ui/command-pending.tsx';
import { SaveRecoveryNotice, useSaveRecovery } from '../app/save-recovery.tsx';
import { Check } from 'lucide-react';
import { useState } from 'react';
import type { InvestmentAction, LoanAction } from '../api/budget-api.ts';
import type { Bill, Entry } from '../api/schemas.ts';
import { useWorkspace } from '../app/workspace.tsx';
import { useI18n, type MessageKey } from '../lib/i18n.tsx';
import type { Currency } from '../lib/money.ts';
import { Dialog } from '../ui/dialog.tsx';
import { LoadState } from '../ui/async.tsx';
import { CorrectForm, InvestForm, LoanForm, WalletForm } from './forms-accounts.tsx';
import { ExchangeForm, ExpenseForm, IncomeForm, MoveForm, RefundForm, TransferForm, type BillIntent } from './forms-everyday.tsx';
import './record-redesign.css';
import { useRecordCopy } from './record-copy.ts';
import { BillForm, FundForm } from './forms-plan.tsx';

export type RecordIntent =
  | { readonly kind: 'expense'; readonly walletId?: string; readonly itemId?: string; readonly bill?: BillIntent }
  | { readonly kind: 'refund' }
  | { readonly kind: 'income'; readonly walletId?: string }
  | { readonly kind: 'transfer' }
  | { readonly kind: 'move'; readonly fromItemId?: string; readonly toItemId?: string; readonly currency?: Currency }
  | { readonly kind: 'exchange' }
  | { readonly kind: 'invest'; readonly action?: InvestmentAction; readonly investmentId?: string }
  | { readonly kind: 'loan'; readonly action?: LoanAction; readonly loanId?: string; readonly bill?: BillIntent }
  | { readonly kind: 'fund'; readonly month?: string }
  | { readonly kind: 'wallet'; readonly walletKind?: 'cash' | 'investment' | 'loan' }
  | { readonly kind: 'correct'; readonly entry: Entry }
  | { readonly kind: 'bill'; readonly bill?: Bill };

type EverydayKind = 'expense' | 'income' | 'transfer' | 'move' | 'exchange' | 'invest' | 'loan' | 'refund';

const EVERYDAY: readonly { readonly kind: EverydayKind; readonly label: MessageKey }[] = [
  { kind: 'expense', label: 'record.kind.expense' },
  { kind: 'income', label: 'record.kind.income' },
  { kind: 'transfer', label: 'record.kind.transfer' },
  { kind: 'move', label: 'record.kind.move' },
  { kind: 'exchange', label: 'record.kind.exchange' },
  { kind: 'invest', label: 'record.kind.invest' },
  { kind: 'loan', label: 'record.kind.loan' },
  { kind: 'refund', label: 'record.kind.refund' },
];

const TITLES: Readonly<Record<RecordIntent['kind'], MessageKey>> = {
  expense: 'record.title', income: 'record.title', transfer: 'record.title', move: 'record.title', exchange: 'record.title',
  invest: 'record.title', loan: 'record.title', refund: 'record.title',
  fund: 'fund.title', wallet: 'wallet.title', correct: 'correct.title', bill: 'bill.title',
};

/** One host for every money action, so screens only describe intent. */
export function RecordDialog({ intent: initial, onClose }: { readonly intent: RecordIntent; readonly onClose: () => void }) {
  return <CommandScope><RecordDialogBody intent={initial} onClose={onClose} /></CommandScope>;
}

function RecordDialogBody({ intent: initial, onClose }: { readonly intent: RecordIntent; readonly onClose: () => void }) {
  const { t, date } = useI18n();
  const copy = useRecordCopy();
  const [choosing, setChoosing] = useState(initial.kind === 'expense' && !initial.walletId && !initial.itemId && !initial.bill);
  const { catalog, space } = useWorkspace();
  const pendingScope = useCommandScope();
  const { attempt } = useSaveRecovery(space.id);
  const pending = Boolean(pendingScope?.pending || attempt?.status === 'pending');
  const [intent, setIntent] = useState<RecordIntent>(initial);
  const [result, setResult] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const everyday = EVERYDAY.some((option) => option.kind === intent.kind) && !('bill' in intent && intent.bill);
  const done = (message: string) => setResult(message);
  return (
    <Dialog pending={pending} title={intent.kind === 'fund' ? `${t('fund.title')} · ${date(intent.month ?? space.currentMonth, 'month')}` : intent.kind === 'bill' ? copy(intent.bill ? 'Edit bill' : 'Add a bill', intent.bill ? 'تعديل فاتورة' : 'إضافة فاتورة') : everyday && !choosing ? t(EVERYDAY.find(option => option.kind === intent.kind)!.label) : t(TITLES[intent.kind])} onClose={onClose} wide={false}>
      <SaveRecoveryNotice onFinished={onClose} />
      {result ? (
        <div className="cr-success-result">
          <div className="cr-success-result-copy" role="status" aria-atomic="true">
            <span className="cr-success-result-icon" aria-hidden="true"><Check size={24} /></span>
            <div>
              <h3>{t(intent.kind === 'exchange' ? 'record.exchangeSaved' : 'record.saved')}</h3>
              <p>{result}</p>
            </div>
          </div>
          <div className="dialog-actions">
            {everyday ? (
              <button type="button" className="cr-button" onClick={() => { setResult(null); setFormKey((value) => value + 1); }}>{t('record.another')}</button>
            ) : null}
            <button type="button" className="cr-button cr-button--primary" data-autofocus="" ref={(button) => { button?.focus(); }} onClick={onClose}>{t('common.done')}</button>
          </div>
        </div>
      ) : (
        <>
            {everyday ? choosing ? (
            <section className="cr-record-chooser" aria-label={t('record.kind')}>
              <p className="cr-helper">{copy('What happened to your money?', 'ماذا حدث لمالك؟')}</p>
              {(['expense', 'income', 'move'] as const).map(kind => <button key={kind} type="button" className="cr-record-option" onClick={() => { if (kind !== intent.kind) setIntent({ kind }); setChoosing(false); }}><strong>{t(`record.kind.${kind}`)}</strong>{' '}<span>{copy(kind === 'expense' ? 'Money you spent.' : kind === 'income' ? 'Money you received.' : 'Move money between plan items.', kind === 'expense' ? 'مال أنفقته.' : kind === 'income' ? 'مال استلمته.' : 'نقل المال بين بنود الخطة.')}</span></button>)}
              <details className="cr-record-details"><summary>{copy('More actions', 'إجراءات أخرى')}</summary>
                {EVERYDAY.filter(option => !['expense', 'income', 'move'].includes(option.kind)).map(option => <button key={option.kind} type="button" className="cr-record-option" onClick={() => { if (option.kind !== intent.kind) setIntent({ kind: option.kind }); setChoosing(false); }}><strong>{t(option.label)}</strong>{' '}<span>{copy(option.kind === 'transfer' ? 'Move real money between your wallets.' : option.kind === 'exchange' ? 'Convert between USD and LBP.' : option.kind === 'invest' ? 'Record investment money, returns or value.' : option.kind === 'loan' ? 'Borrow, lend or repay money.' : 'Money returned from an earlier expense.', option.kind === 'transfer' ? 'نقل المال الفعلي بين محافظك.' : option.kind === 'exchange' ? 'التحويل بين الدولار والليرة.' : option.kind === 'invest' ? 'تسجيل أموال الاستثمار والعوائد والقيمة.' : option.kind === 'loan' ? 'اقتراض أو إقراض أو سداد المال.' : 'مال مسترجع من مصروف سابق.')}</span></button>)}
              </details>
            </section>
          ) : <button type="button" disabled={pending} className="cr-record-back" onClick={() => setChoosing(true)}>{copy('All actions', 'كل الإجراءات')}</button> : null}
          <div hidden={choosing}>
          <LoadState loaded={catalog}>
            {(data) => {
              const key = `${intent.kind}-${formKey}`;
              const props = { catalog: data, onDone: done, onCancel: onClose };
              switch (intent.kind) {
                case 'expense': return <ExpenseForm key={key} {...props} {...(intent.walletId ? { walletId: intent.walletId } : {})} {...(intent.itemId ? { itemId: intent.itemId } : {})} {...(intent.bill ? { bill: intent.bill } : {})} />;
                case 'refund': return <RefundForm key={key} {...props} />;
                case 'income': return <IncomeForm key={key} {...props} {...(intent.walletId ? { walletId: intent.walletId } : {})} onFund={() => { setResult(null); setIntent({ kind: 'fund' }); }} />;
                case 'transfer': return <TransferForm key={key} {...props} />;
                case 'move': return <MoveForm key={key} {...props} {...(intent.fromItemId ? { fromItemId: intent.fromItemId } : {})} {...(intent.toItemId ? { toItemId: intent.toItemId } : {})} {...(intent.currency ? { currency: intent.currency } : {})} />;
                case 'exchange': return <ExchangeForm key={key} {...props} />;
                case 'invest': return <InvestForm key={key} {...props} {...(intent.action ? { action: intent.action } : {})} {...(intent.investmentId ? { investmentId: intent.investmentId } : {})} />;
                case 'loan': return <LoanForm key={key} {...props} {...(intent.action ? { action: intent.action } : {})} {...(intent.loanId ? { loanId: intent.loanId } : {})} {...(intent.bill ? { bill: intent.bill } : {})} />;
                case 'fund': return <FundForm key={key} {...props} month={intent.month ?? space.currentMonth} />;
                case 'wallet': return <WalletForm key={key} onDone={done} onCancel={onClose} {...(intent.walletKind ? { kind: intent.walletKind } : {})} />;
                case 'correct': return <CorrectForm key={key} entry={intent.entry} onDone={done} onCancel={onClose} />;
                case 'bill': return <BillForm key={key} {...props} {...(intent.bill ? { bill: intent.bill } : {})} />;
              }
            }}
          </LoadState>
          </div>
        </>
      )}
    </Dialog>
  );
}
