import { useWorkspace } from '../../app/workspace.tsx';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import type { RecordIntent } from '../../record/record-dialog.tsx';
import type { Bill, BillOccurrence } from '../../api/schemas.ts';
import { ErrorNotice, LoadState, useCommand, useLoad } from '../../ui/async.tsx';
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
              const lastSkipped = [...upcoming].reverse().find((occurrence) => occurrence.billId === bill.billId && occurrence.status === 'skipped');
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
                  <SkipActions bill={bill} next={next} lastSkipped={lastSkipped} />
                </li>
              );
            })}
          </ul>
        )}
      </LoadState>
    </section>
  );
}

/**
 * Skipping says "this occurrence will not be paid"; it moves no money.
 * Undo skip brings back the most recently skipped occurrence.
 */
function SkipActions({ bill, next, lastSkipped }: {
  readonly bill: Bill;
  readonly next: BillOccurrence | undefined;
  readonly lastSkipped: BillOccurrence | undefined;
}) {
  const { t } = useI18n();
  const { api, space, refresh } = useWorkspace();
  const skip = useCommand((requestId, due: string) => api.skipBill({ spaceId: space.id, requestId, billId: bill.billId, due }));
  const unskip = useCommand((requestId, due: string) => api.unskipBill({ spaceId: space.id, requestId, billId: bill.billId, due }));
  const pending = skip.pending || unskip.pending;
  const run = async (command: typeof skip, due: string) => {
    if (await command.submit(due)) refresh();
  };
  const error = skip.error ?? unskip.error;
  return (
    <>
      {next ? <button type="button" className="cr-link-button" disabled={pending} onClick={() => void run(skip, next.dueOn)}>{t('bill.skip')}</button> : null}
      {lastSkipped ? <button type="button" className="cr-link-button" disabled={pending} onClick={() => void run(unskip, lastSkipped.dueOn)}>{t('bill.unskip')}</button> : null}
      {error ? <ErrorNotice error={error} /> : null}
    </>
  );
}
