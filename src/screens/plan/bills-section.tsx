import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import { LoadState, useLoad } from '../../ui/async.tsx';
import { Amount } from '../../ui/money.tsx';
import { addDays } from '../describe.ts';
import { billIntent, CoveragePill } from '../home/home.tsx';

const CADENCE: Readonly<Record<'monthly' | 'yearly' | 'once', MessageKey>> = {
  monthly: 'bill.cadence.monthly',
  yearly: 'bill.cadence.yearly',
  once: 'bill.cadence.once',
};

/** Bills read their item's balance; they never hold money of their own. */
export function BillsSection({ onRecord }: { readonly onRecord: (intent: RecordIntent) => void }) {
  const { t, date, name } = useI18n();
  const { api, space, version } = useWorkspace();
  const bills = useLoad(async () => {
    const [list, upcoming] = await Promise.all([api.billsList(space.id), api.billsUpcoming(space.id, addDays(space.today, -31), addDays(space.today, 62))]);
    return { list, upcoming };
  }, [api, space.id, space.today, version]);
  return (
    <section className="cr-card" aria-labelledby="bills-section-heading">
      <div className="cr-section-header">
        <div>
          <h2 id="bills-section-heading">{t('bill.sectionTitle')}</h2>
          <p className="cr-helper">{t('bill.sectionIntro')}</p>
        </div>
        <button type="button" className="cr-button cr-button--sm" onClick={() => onRecord({ kind: 'bill' })}>{t('bill.add')}</button>
      </div>
      <LoadState loaded={bills}>
        {({ list, upcoming }) => list.length === 0 ? <p className="cr-helper">{t('bill.none')}</p> : (
          <ul className="cr-register">
            {list.map((bill) => {
              const next = upcoming.find((occurrence) => occurrence.billId === bill.billId && (occurrence.status === 'due' || occurrence.status === 'overdue'));
              const lastPaid = [...upcoming].reverse().find((occurrence) => occurrence.billId === bill.billId && occurrence.status === 'paid');
              return (
                <li key={bill.billId} className="cr-register-row">
                  <div className="cr-register-main">
                    <button type="button" className="cr-link-button cr-register-title" onClick={() => onRecord({ kind: 'bill', bill })}><bdi>{bill.name}</bdi></button>
                    <span className="cr-helper">
                      {t(CADENCE[bill.cadence])}
                      {next ? ` · ${t('bill.nextDue', { date: date(next.dueOn, 'short') })}` : ''}
                      {lastPaid ? ` · ${t('bill.lastPaid', { date: date(lastPaid.dueOn, 'short') })}` : ''}
                    </span>
                    {next ? <span className="cr-helper"><bdi>{name({ nameEn: next.itemNameEn, nameAr: next.itemNameAr })}</bdi></span> : null}
                  </div>
                  {next ? <CoveragePill occurrence={next} /> : null}
                  <Amount minor={bill.amount} currency={bill.currency} />
                  {next ? <button type="button" className="cr-button cr-button--sm" onClick={() => onRecord(billIntent(next))}>{t('bill.pay')}</button> : null}
                </li>
              );
            })}
          </ul>
        )}
      </LoadState>
    </section>
  );
}
