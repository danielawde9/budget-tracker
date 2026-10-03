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
  const { t } = useI18n();
  const { catalog, space } = useWorkspace();
  const [intent, setIntent] = useState<RecordIntent>(initial);
  const [result, setResult] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const everyday = EVERYDAY.some((option) => option.kind === intent.kind) && !('bill' in intent && intent.bill);
  const done = (message: string) => setResult(message);
  return (
    <Dialog title={t(TITLES[intent.kind])} onClose={onClose} wide={intent.kind === 'fund'}>
      {result ? (
        <div className="dialog-result" role="status">
          <p>{result}</p>
          <div className="dialog-actions">
            {everyday ? (
              <button type="button" className="cr-button" onClick={() => { setResult(null); setFormKey((value) => value + 1); }}>{t('record.another')}</button>
            ) : null}
            <button type="button" className="cr-button cr-button--primary" data-autofocus="" onClick={onClose}>{t('common.done')}</button>
          </div>
        </div>
      ) : (
        <>
          {everyday ? (
            <div className="cr-chips cr-record-kinds" role="group" aria-label={t('record.kind')}>
              {EVERYDAY.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  className={intent.kind === option.kind ? 'cr-chip cr-chip--active' : 'cr-chip'}
                  aria-pressed={intent.kind === option.kind}
                  onClick={() => setIntent({ kind: option.kind } as RecordIntent)}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
          ) : null}
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
        </>
      )}
    </Dialog>
  );
}
