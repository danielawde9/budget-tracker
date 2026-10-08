import { useId, useRef, useState } from 'react';
import { BudgetError, toBudgetError, type BudgetError as ErrorType } from '../../api/budget-api.ts';
import type { AccountWallet, WalletStatement } from '../../api/schemas.ts';
import { useWorkspace } from '../../app/workspace.tsx';
import { routeHash } from '../../app/router.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { parseMoney } from '../../lib/money.ts';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { ErrorNotice } from '../../ui/async.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Amount } from '../../ui/money.tsx';

/** Pure comparison: the entered statement amount stays on this screen. */
export function WalletStatementDialog({ wallet, onClose, onRecord }: {
  readonly wallet: AccountWallet;
  readonly onClose: () => void;
  readonly onRecord: (intent: RecordIntent) => void;
}) {
  const amountId = useId();
  const { t } = useI18n();
  const { api, space } = useWorkspace();
  const [on, setOn] = useState(space.today);
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ statement: WalletStatement; observed: bigint } | null>(null);
  const [error, setError] = useState<ErrorType | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  function edited() { generation.current += 1; setResult(null); setError(null); }
  async function compare() {
    if (inFlight.current) return;
    const signed = text.trim().startsWith('-');
    const parsed = parseMoney(signed ? text.trim().slice(1) : text, wallet.currency);
    if (parsed === null) { setError(new BudgetError('BUDGET_INVALID_AMOUNT')); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on < '2000-01-01' || on > space.today) { setError(new BudgetError('BUDGET_INVALID_DATE')); return; }
    const current = generation.current;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const statement = await api.walletBalanceOn(space.id, wallet.id, on);
      if (generation.current === current) setResult({ statement, observed: signed ? -parsed : parsed });
    } catch (failure) {
      if (generation.current === current) setError(toBudgetError(failure));
    } finally { inFlight.current = false; setPending(false); }
  }
  const difference = result ? result.observed - result.statement.balance : 0n;
  return <Dialog title={t('statement.check')} description={wallet.name} onClose={onClose}>
    <form className="cr-stack" onSubmit={(event) => { event.preventDefault(); void compare(); }}>
      <p className="cr-helper">{t('statement.readOnly')}</p>
      <fieldset className="cr-form-section" disabled={pending}>
        <legend>{t('statement.details')}</legend>
        <label className="cr-field"><span className="cr-label">{t('statement.date')}</span><input name="statementDate" type="date" required min="2000-01-01" max={space.today} value={on} onChange={(event) => { edited(); setOn(event.target.value); }} /></label>
        <div className="cr-field"><label className="cr-label" htmlFor={amountId}>{t('statement.balance')}</label><span className="cr-affix"><input id={amountId} name="statementBalance" type="text" inputMode={wallet.currency === 'USD' ? 'decimal' : 'numeric'} dir="ltr" autoComplete="off" required value={text} onChange={(event) => { edited(); setText(event.target.value); }} /><span className="cr-affix-suffix" aria-hidden>{wallet.currency}</span></span></div>
        <p className="cr-helper">{t(wallet.currency === 'USD' ? 'statement.cents' : 'statement.whole')}</p>
      </fieldset>
      {error ? <ErrorNotice error={error} /> : null}
      <button type="submit" className="cr-button cr-button--primary" disabled={pending}>{pending ? t('common.loading') : t('statement.compare')}</button>
      {result ? <section className="cr-stack" aria-live="polite">
        <p>{t('statement.recordedNow')} <Amount minor={result.statement.balance} currency={wallet.currency} /></p>
        <p>{difference === 0n ? t('statement.match') : <>{t(difference > 0n ? 'statement.more' : 'statement.less')} <Amount minor={difference < 0n ? -difference : difference} currency={wallet.currency} /></>}</p>
        <div className="dialog-actions">
          <a className="cr-button" href={routeHash({ name: 'activity', walletId: wallet.id, month: `${result.statement.on.slice(0, 7)}-01` })} onClick={onClose}>{t('statement.activity')}</a>
          <button type="button" className="cr-button" onClick={() => onRecord({ kind: 'expense', walletId: wallet.id })}>{t('statement.record')}</button>
        </div>
      </section> : null}
    </form>
  </Dialog>;
}
