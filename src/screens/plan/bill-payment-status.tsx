import type { BillOccurrence } from '../../api/schemas.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Amount } from '../../ui/money.tsx';

export const isOpenBill = (bill: BillOccurrence) => bill.status === 'due' || bill.status === 'overdue' || bill.status === 'part_paid';
export const billRemaining = (bill: BillOccurrence) => bill.remaining ?? (bill.expected > bill.paidAmount ? bill.expected - bill.paidAmount : 0n);

export function BillPaymentStatus({ occurrence }: { readonly occurrence: BillOccurrence }) {
  const { t } = useI18n();
  const excess = occurrence.overpaid ?? (occurrence.paidAmount > occurrence.expected ? occurrence.paidAmount - occurrence.expected : 0n);
  if (occurrence.paidAmount === 0n) return null;
  return <span className="cr-helper">
    {occurrence.status === 'part_paid' ? `${t('bill.status.partial')} · ` : ''}
    {t('bill.paidAmount')} <Amount minor={occurrence.paidAmount} currency={occurrence.currency} />
    {billRemaining(occurrence) > 0n ? <> · {t('bill.remaining')} <Amount minor={billRemaining(occurrence)} currency={occurrence.currency} /></> : null}
    {excess > 0n ? <> · {t('bill.excess')} <Amount minor={excess} currency={occurrence.currency} /></> : null}
  </span>;
}
