import { useEffect, useState } from 'react';
import type { Entry } from '../../api/schemas.ts';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { ErrorNotice, useCommand, useLoad } from '../../ui/async.tsx';
import { SelectField } from '../../ui/select-field.tsx';
import { billRemaining, isOpenBill } from '../plan/bill-payment-status.tsx';

export function BillPaymentLinkForm({ entry, onDone, onCancel, onPending }: {
  readonly entry: Entry; readonly onDone: () => void; readonly onCancel: () => void; readonly onPending: (pending: boolean) => void;
}) {
  const { api, space, refresh } = useWorkspace();
  const { t, money, date } = useI18n();
  const [due, setDue] = useState(entry.billDueOn ?? space.today);
  const [billId, setBillId] = useState('');
  const bills = useLoad(() => due ? api.billsUpcoming(space.id, due, due) : Promise.resolve([]), [api, space.id, due]);
  const purpose = entry.items.find((item) => item.flow === 'spend' || item.flow === 'principal' || item.flow === 'interest' || item.flow === 'fee');
  const cash = entry.wallets.find((wallet) => wallet.kind === 'cash' && wallet.amount < 0n);
  const loanId = entry.billPaymentLoanWalletId ?? entry.wallets.find((wallet) => wallet.kind === 'loan')?.walletId ?? null;
  const command = useCommand((requestId, target: { billId: string | null; due: string | null }) => api.moveBillPayment({
    spaceId: space.id, requestId, entryId: entry.entryId, expectedVersion: entry.billLinkVersion ?? 0, ...target,
  }));
  useEffect(() => onPending(command.pending), [command.pending, onPending]);
  useEffect(() => { if (command.error?.code === 'BUDGET_BILL_LINK_CHANGED') refresh(); }, [command.error?.code, refresh]);
  const targets = bills.status === 'ready' ? bills.data.filter((bill) => isOpenBill(bill) && bill.itemId === purpose?.itemId && bill.currency === cash?.currency
    && bill.loanWalletId === loanId
    && bill.dueOn === due && !(bill.billId === entry.billId && bill.dueOn === entry.billDueOn)) : [];
  const run = async (target: { billId: string | null; due: string | null }) => {
    if (await command.submit(target)) { refresh(); onDone(); }
  };
  // Keep a lost-response retry identical to the initial command.
  const uncertain = command.error?.code === 'NETWORK' || command.error?.code === 'TIMEOUT' || command.error?.code === 'BAD_RESPONSE';
  const locked = command.pending || uncertain;
  return <form className="cr-stack" onSubmit={(event) => { event.preventDefault(); if (targets.some((bill) => bill.billId === billId)) void run({ billId, due }); }}>
    <p className="cr-helper">{t('bill.linkIntro')}</p>
    <label className="cr-field"><span className="cr-label">{t('bill.targetDue')}</span><input type="date" required value={due} disabled={locked} onChange={(event) => { setDue(event.target.value); setBillId(''); command.resetRequest(); }} /></label>
    <SelectField label={t('bill.target')} value={billId} disabled={locked || bills.status !== 'ready'} onChange={(event) => { setBillId(event.target.value); command.resetRequest(); }}>
      <option value="">{t('bill.chooseTarget')}</option>
      {targets.map((bill) => <option key={bill.billId} value={bill.billId}>{bill.name} · {date(bill.dueOn, 'short')} · {money(billRemaining(bill), bill.currency)}</option>)}
    </SelectField>
    {bills.status === 'loading' ? <p role="status">{t('common.loading')}</p> : null}
    {bills.status === 'error' ? <ErrorNotice error={bills.error} onRetry={bills.reload} /> : null}
    {bills.status === 'ready' && targets.length === 0 ? <p className="cr-helper">{t('bill.noTarget')}</p> : null}
    {command.error ? <ErrorNotice error={command.error} /> : null}
    <div className="dialog-actions">
      <button type="button" className="cr-button" disabled={command.pending} onClick={() => { refresh(); onCancel(); }}>{t('common.cancel')}</button>
      {entry.billId ? <button type="button" className="cr-button" disabled={command.pending || (uncertain && billId !== '')} onClick={() => { setBillId(''); void run({ billId: null, due: null }); }}>{t('bill.detachPayment')}</button> : null}
      <button type="submit" className="cr-button cr-button--primary" disabled={command.pending || !billId || !targets.some((bill) => bill.billId === billId)}>{t('bill.movePayment')}</button>
    </div>
  </form>;
}
