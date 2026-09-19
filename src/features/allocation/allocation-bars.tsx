import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { chartPercent } from './chart-ratio.js';
import type { AllocationGroupRow } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

function rowLabel(row: AllocationGroupRow, locale: Locale): string {
  if (row.rowKind === 'unmapped') return t(locale, 'Unmapped', 'غير مرتبط');
  if (row.rowKind === 'uncategorized') return t(locale, 'Uncategorized', 'غير مصنّف');
  const name = locale === 'ar' ? row.nameAr : row.nameEn;
  return name ?? (locale === 'ar' ? row.nameEn : row.nameAr) ?? t(locale, 'Group', 'مجموعة');
}

export interface AllocationBarsProps {
  locale: Locale;
  currency: Currency;
  /** Whether the month has any published plan at all -- when false, every
   * row shows "No target" regardless of its own numeric target field. */
  monthHasPlan: boolean;
  rows: readonly AllocationGroupRow[];
  onDrilldown?: ((row: AllocationGroupRow) => void) | undefined;
}

/** Group/category actuals and targets as an accessible bar chart with a full
 * numeric table equivalent. Reads only checked DTO values; never recomputes
 * an actual from wallet history. Reduced-motion users get no animated count --
 * there is no counting animation here at all. */
export function AllocationBars(props: AllocationBarsProps) {
  const { locale, currency, monthHasPlan, rows } = props;
  return (
    <div className="alloc-bars">
      <table className="alloc-bars-table">
        <caption className="alloc-visually-hidden">
          {t(locale, 'Allocation groups: target versus actual', 'مجموعات التخصيص: الهدف مقابل الفعلي')}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t(locale, 'Group', 'المجموعة')}</th>
            <th scope="col">{t(locale, 'Target', 'الهدف')}</th>
            <th scope="col">{t(locale, 'Actual', 'الفعلي')}</th>
            <th scope="col">{t(locale, 'Variance', 'الفرق')}</th>
            <th scope="col">{t(locale, '% of income', 'نسبة من الدخل')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const label = rowLabel(row, locale);
            const rowHasTarget = monthHasPlan && row.hasPlan;
            const target = rowHasTarget ? row.targetMinor : null;
            const actual = BigInt(row.actualMinor);
            const negative = actual < 0n;
            const percent = target !== null ? chartPercent(negative ? '0' : row.actualMinor, target) : 0;
            const over = target !== null && BigInt(target) > 0n && actual > BigInt(target);
            const overageMinor = over && target !== null ? (actual - BigInt(target)).toString() : null;
            const key = row.groupId ?? row.rowKind;
            const future = row.rowKind === 'future';

            return (
              <tr key={key} className="alloc-bar-row">
                <th scope="row" className="alloc-bar-label">
                  <bdi>{label}</bdi>
                  {row.basisPoints !== null ? <span className="alloc-bar-bps">{(row.basisPoints / 100).toString()}% {t(locale, 'target', 'هدف')}</span> : null}
                </th>
                <td data-label={t(locale, 'Target', 'الهدف')}>
                  {target === null ? (
                    <span className="alloc-label-muted">{t(locale, 'No target', 'بدون هدف')}</span>
                  ) : (
                    <bdi>{formatMinorAmount(target, currency, locale)}</bdi>
                  )}
                </td>
                <td data-label={t(locale, 'Actual', 'الفعلي')}>
                  <bdi className={negative ? 'alloc-danger-text' : undefined}>{formatMinorAmount(row.actualMinor, currency, locale)}</bdi>
                  {future ? <span className="alloc-label-muted">{' '}{t(locale, '(paid/allocated)', '(مدفوع/مخصَّص)')}</span> : null}
                </td>
                <td data-label={t(locale, 'Variance', 'الفرق')}>
                  {row.varianceMinor === null ? (
                    <span className="alloc-label-muted">—</span>
                  ) : (
                    <bdi className={BigInt(row.varianceMinor) < 0n ? 'alloc-danger-text' : undefined}>
                      {formatMinorAmount(row.varianceMinor, currency, locale)}
                    </bdi>
                  )}
                </td>
                <td data-label={t(locale, '% of income', 'نسبة من الدخل')}>
                  {row.actualShareOfIncomeBps !== null && row.actualShareOfIncomeBps !== '0' ? (
                    <bdi>{(BigInt(row.actualShareOfIncomeBps) / 100n).toString()}%</bdi>
                  ) : (
                    <span className="alloc-label-muted">—</span>
                  )}
                </td>
                <td className="alloc-bar-visual">
                  {target !== null && BigInt(target) > 0n ? (
                    <div className="alloc-progress" data-over={over ? 'true' : undefined} aria-hidden="true">
                      <span style={{ inlineSize: `${percent}%` }} />
                    </div>
                  ) : null}
                  {over && overageMinor ? (
                    <span className="alloc-overage-text">
                      +{formatMinorAmount(overageMinor, currency, locale)} {t(locale, 'over', 'زيادة')}
                    </span>
                  ) : null}
                  {props.onDrilldown && (row.rowKind === 'spending' || row.rowKind === 'unmapped' || row.rowKind === 'uncategorized') ? (
                    <button
                      type="button"
                      className="cr-button alloc-drilldown-button"
                      aria-label={t(locale, `View ${label} categories`, `عرض فئات ${label}`)}
                      onClick={() => props.onDrilldown?.(row)}
                    >
                      {t(locale, 'View', 'عرض')}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
