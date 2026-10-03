import { useId, useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { CURRENCY_DECIMALS, parseMoney, toInputText, type Currency } from '../lib/money.ts';

export type Tone = 'plain' | 'positive' | 'negative' | 'warn';

/** An amount as one unbreakable, direction-isolated unit with tabular digits. */
export function Amount({ minor, currency, sign = false, tone = 'plain', className = '' }: {
  readonly minor: bigint;
  readonly currency: Currency;
  readonly sign?: boolean;
  readonly tone?: Tone;
  readonly className?: string;
}) {
  const { money } = useI18n();
  const toneClass = tone === 'plain' ? '' : ` cr-amount--${tone}`;
  return (
    <bdi className={`cr-amount${toneClass}${className ? ` ${className}` : ''}`} dir="ltr">
      {money(minor, currency, { sign })}
    </bdi>
  );
}

export interface MoneyFieldProps {
  readonly label: string;
  readonly currency: Currency;
  readonly value: bigint | null;
  readonly onChange: (value: bigint | null) => void;
  readonly required?: boolean;
  readonly autoFocus?: boolean;
  readonly hint?: string | undefined;
  readonly allowZero?: boolean;
  readonly name?: string;
  /** Keeps the accessible name but hides the visible label (dense editors). */
  readonly hideLabel?: boolean;
}

/**
 * A text field (not type=number) with a decimal keypad; accepts Latin or
 * Arabic-Indic digits. Validation shows after the person leaves the field.
 */
export function MoneyField({ label, currency, value, onChange, required = true, autoFocus = false, hint, allowZero = false, name, hideLabel = false }: MoneyFieldProps) {
  const { t } = useI18n();
  const [text, setText] = useState(value === null ? '' : toInputText(value, currency));
  const [touched, setTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const hintId = useId();
  const errorId = useId();
  const parsed = text.trim() === '' ? null : parseMoney(text, currency);
  const invalid = (text.trim() !== '' && parsed === null) || (parsed !== null && parsed === 0n && !allowZero) || (required && text.trim() === '');
  // Errors wait until the person has typed here and left the field.
  const showError = touched && dirty && invalid;
  const describedBy = [hint ? hintId : null, showError ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="cr-money-field">
      <label className="cr-field">
        <span className={hideLabel ? 'cr-visually-hidden' : 'cr-label'}>{label}</span>
        <span className="cr-affix">
          <input
            type="text"
            inputMode={CURRENCY_DECIMALS[currency] === 0 ? 'numeric' : 'decimal'}
            autoComplete="off"
            enterKeyHint="done"
            dir="ltr"
            name={name}
            data-autofocus={autoFocus ? '' : undefined}
            required={required}
            aria-invalid={showError}
            aria-describedby={describedBy}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
              const next = event.target.value.trim() === '' ? null : parseMoney(event.target.value, currency);
              onChange(next !== null && next === 0n && !allowZero ? null : next);
            }}
            onBlur={() => setTouched(true)}
          />
          <span className="cr-affix-suffix" aria-hidden="true">{currency}</span>
        </span>
      </label>
      {hint ? <p id={hintId} className="cr-helper">{hint}</p> : null}
      {showError ? <p id={errorId} className="cr-field-error" role="alert">{t('error.BUDGET_INVALID_AMOUNT')}</p> : null}
    </div>
  );
}
