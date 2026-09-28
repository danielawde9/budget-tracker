import { useState } from 'react';
import type { Currency, Locale } from '../loans/types.js';
import { formatMinorAmount } from '../wallets/money.js';
import { classifyAllocationError, localizeAllocationError } from './errors.js';
import type { CommandOutcome } from './use-allocation.js';
import type { CloseRootRow } from './types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

function rootName(root: CloseRootRow, locale: Locale): string {
  return (locale === 'ar' ? root.nameAr : root.nameEn) ?? root.nameEn ?? root.nameAr ?? '';
}

export interface RolloverPolicyEditorProps {
  readonly locale: Locale;
  readonly currency: Currency;
  /** The month's snapshot roots, each carrying its current policy head
   * (`policyRevisionId`) and enabled flag from the close preview. */
  readonly roots: readonly CloseRootRow[];
  readonly pending: boolean;
  onSetRollover(input: { rootId: string; enabled: boolean; expectedRevisionId: string | null }): Promise<CommandOutcome>;
}

/** Explicit per-root opt-in for signed carry. Absent policy is disabled; an
 * overspent enabled root shows its negative outgoing carry, never clamped and
 * never turned into income. */
export function RolloverPolicyEditor(props: RolloverPolicyEditorProps) {
  const { locale } = props;
  const [error, setError] = useState<string | null>(null);

  const toggle = async (root: CloseRootRow, enabled: boolean) => {
    setError(null);
    try {
      const outcome = await props.onSetRollover({ rootId: root.categoryId, enabled, expectedRevisionId: root.policyRevisionId });
      if (outcome.status === 'ambiguous') {
        setError(t(locale, 'The policy change is not confirmed yet. Check again before editing further.', 'لم يتم تأكيد تغيير السياسة بعد. تحقق مرة أخرى قبل متابعة التحرير.'));
      }
    } catch (cause) {
      const view = localizeAllocationError(classifyAllocationError(cause), locale);
      setError(`${view.message} ${view.recovery}`);
    }
  };

  return (
    <fieldset className="mt-rollover" aria-label={t(locale, 'Carry into next month', 'الترحيل إلى الشهر التالي')}>
      <legend>{t(locale, 'Carry into next month', 'الترحيل إلى الشهر التالي')}</legend>
      <p className="cr-helper">
        {t(locale,
          'Carry is signed and is a distinct adjustment, never income. Categories left off carry nothing.',
          'الترحيل قيمة موقّعة وتعديل مستقل، وليس دخلًا. الفئات غير المفعّلة لا ترحّل شيئًا.')}
      </p>
      {props.roots.length === 0 ? (
        <p className="cr-helper">{t(locale, "No expense categories in this month's plan.", 'لا توجد فئات مصروفات في خطة هذا الشهر.')}</p>
      ) : (
        <ul className="mt-rollover-list">
          {props.roots.map((root) => {
            const name = rootName(root, locale);
            return (
              <li key={root.categoryId} className="mt-rollover-row">
                <label className="mt-rollover-toggle">
                  <input
                    type="checkbox"
                    checked={root.enabled}
                    disabled={props.pending}
                    aria-label={t(locale, `Carry ${name} into next month`, `ترحيل ${name} إلى الشهر التالي`)}
                    onChange={(event) => void toggle(root, event.target.checked)}
                  />
                  <bdi>{name}</bdi>
                </label>
                {root.enabled ? (
                  <span className="mt-rollover-carry">
                    <span className="cr-helper">{t(locale, 'Carried', 'المُرحّل')}</span>{' '}
                    <bdi>{formatMinorAmount(root.outgoingCarryMinor, props.currency, locale)}</bdi>
                  </span>
                ) : (
                  <span className="cr-helper">{t(locale, 'No carry', 'بدون ترحيل')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className="mt-danger" role="alert">{error}</p> : null}
    </fieldset>
  );
}
