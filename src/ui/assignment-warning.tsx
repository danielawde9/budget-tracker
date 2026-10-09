import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { useUiCopy } from '../lib/ui-copy.ts';
import type { Currency } from '../lib/money.ts';
import { Amount } from './money.tsx';

/** The same correction state on Home and Plan; amounts remain database values. */
export function AssignmentWarning({ shortfall, currency, onFix, controls }: {
  readonly shortfall: bigint;
  readonly currency: Currency;
  readonly onFix: () => void;
  readonly controls?: ReactNode;
}) {
  const { t } = useI18n();
  const c = useUiCopy();
  return <div className="cr-assignment-warning">
    <div className="cr-warning-heading"><h2><CircleAlert size={22} aria-hidden />{t('home.overAssigned')}</h2>{controls}</div>
    <Amount minor={shortfall} currency={currency} className="cr-amount--hero" tone="negative" />
    <p className="cr-helper">{c('overAssignedBody')}</p>
    <button type="button" className="cr-button cr-button--primary" onClick={onFix}>{c('fixAssignment')}</button>
  </div>;
}
