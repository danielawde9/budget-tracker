import type { MoneyPurpose } from '../../lib/money-purpose.ts';
import { useUiCopy } from '../../lib/ui-copy.ts';
import { usePlanCopy } from './plan-copy.ts';
import { MoneyHelp } from '../../ui/money-help.tsx';
import './plan-redesign.css';
import type { PlanItem, StatementRow } from '../../api/schemas.ts';
import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Amount } from '../../ui/money.tsx';
import { describeEntry } from '../describe.ts';

const ROWS: readonly { readonly key: keyof Omit<StatementRow, 'currency'>; readonly label: MessageKey; readonly sign: 1 | -1 }[] = [
  { key: 'broughtForward', label: 'statement.broughtForward', sign: 1 },
  { key: 'opening', label: 'statement.opening', sign: 1 },
  { key: 'funded', label: 'statement.funded', sign: 1 },
  { key: 'movedIn', label: 'statement.movedIn', sign: 1 },
  { key: 'movedOut', label: 'statement.movedOut', sign: -1 },
  { key: 'coveredIn', label: 'statement.coveredIn', sign: 1 },
  { key: 'coveredOut', label: 'statement.coveredOut', sign: -1 },
  { key: 'spent', label: 'statement.spent', sign: -1 },
  { key: 'otherOut', label: 'statement.otherOut', sign: -1 },
  { key: 'exchanged', label: 'statement.exchanged', sign: 1 },
];

/** Where an item's money came from and went this month, in each currency. */
export function ItemStatementDialog({ item, month, onClose, onRecord, purpose = 'spending' }: {
  readonly purpose?: MoneyPurpose;
  readonly item: PlanItem;
  readonly month: string;
  readonly onClose: () => void;
  readonly onRecord: (intent: RecordIntent) => void;
}) {
  const copy = usePlanCopy();
  const c = useUiCopy();
  const i18n = useI18n();
  const { t, name, date } = i18n;
  const { api, space, version } = useWorkspace();
  const statement = useLoad(() => api.itemStatement(space.id, item.itemId, month), [api, space.id, item.itemId, month, version]);
  return (
    <Dialog title={name(item)} onClose={onClose} wide description={t('statement.intro', { month: date(month, 'month') })}>
      <LoadState loaded={statement}>
        {(data) => (
          <div className="cr-stack">
            {purpose === 'saving' ? <div className="cr-explain"><p>{c('carryHelp')}</p><p>{c('savingsHow')}</p><p>{c('useSavingsHelp')}</p></div> : null}
            {data.statement.length === 0 ? <p className="cr-helper">{t('statement.empty')}</p> : null}
            {data.statement.map((row) => <section className="plan-statement-summary" key={row.currency}>
              <h3>{c('balanceEnd')} <MoneyHelp term="available" /></h3>
              <Amount minor={row.available} currency={row.currency} />
              <dl className="cr-figures">
                <div><dt>{c('balanceStart')}</dt><dd><Amount minor={row.broughtForward} currency={row.currency} /></dd></div>
                <div><dt>{c('addedMonth')}</dt><dd><Amount minor={row.opening + row.funded + row.movedIn + row.coveredIn + (row.exchanged > 0n ? row.exchanged : 0n)} currency={row.currency} sign /></dd></div>
                <div><dt>{c('usedMonth')}</dt><dd><Amount minor={-(row.spent + row.otherOut + row.movedOut + row.coveredOut) + (row.exchanged < 0n ? row.exchanged : 0n)} currency={row.currency} sign /></dd></div>
              </dl>
            </section>)}
            <details className="plan-item-options" open>
            <summary>{copy.breakdown}</summary>
            {data.statement.map((row) => (
              <table key={row.currency} className="cr-statement">
                <caption>{row.currency}</caption>
                <tbody>
                  {ROWS.filter((line) => row[line.key] !== 0n).map((line) => (
                    <tr key={line.key}>
                      <th scope="row">{t(line.label)}</th>
                      <td><Amount minor={row[line.key] * BigInt(line.sign)} currency={row.currency} sign /></td>
                    </tr>
                  ))}
                  <tr className="cr-statement-total">
                    <th scope="row">{t('statement.available')}</th>
                    <td><Amount minor={row.available} currency={row.currency} /></td>
                  </tr>
                </tbody>
              </table>
            ))}
            </details>
            <h3>{t('statement.entries')}</h3>
            {data.entries.length === 0 ? <p className="cr-helper">{t('activity.empty')}</p> : (
              <ul className="cr-register">
                {data.entries.map((entry) => {
                  const line = describeEntry(i18n, entry);
                  const mine = entry.items.filter((itemLine) => itemLine.itemId === item.itemId);
                  return (
                    <li key={entry.entryId} className="cr-register-row">
                      <div className="cr-register-main">
                        <bdi className="cr-register-title">{line.title}</bdi>
                        <span className="cr-helper">{date(entry.occurredOn, 'short')}{line.detail ? ' · ' : ''}<bdi>{line.detail}</bdi></span>
                      </div>
                      <span className="cr-amounts">
                        {mine.map((itemLine, index) => <Amount key={index} minor={itemLine.amount} currency={itemLine.currency} sign />)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="dialog-actions">
              <button type="button" className="cr-button" onClick={() => onRecord({ kind: 'move', toItemId: item.itemId })}>{t('statement.moveIn')}</button>
              <button type="button" className="cr-button" onClick={() => onRecord({ kind: 'move', fromItemId: item.itemId })}>{t('statement.moveOut')}</button>
              <button type="button" className="cr-button cr-button--primary" onClick={() => onRecord(purpose === 'investment' ? { kind: 'invest', action: 'contribute', itemId: item.itemId } : { kind: 'expense', itemId: item.itemId })}>{purpose === 'investment' ? t('record.kind.invest') : t('statement.spend')}</button>
            </div>
          </div>
        )}
      </LoadState>
    </Dialog>
  );
}
