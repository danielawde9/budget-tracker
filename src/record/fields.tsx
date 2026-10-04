import { useEffect, type ReactNode } from 'react';
import type { AccountWallet } from '../api/schemas.ts';
import { findItem, pickerGroups, type Catalog, type PickerGroup } from '../app/workspace.tsx';
import { useI18n, type I18n, type MessageKey } from '../lib/i18n.tsx';
import { SelectField } from '../ui/select-field.tsx';
import type { Currency } from '../lib/money.ts';

export function WalletSelect({ label, wallets, value, onChange, currency }: {
  readonly label: string;
  readonly wallets: readonly AccountWallet[];
  readonly value: string;
  readonly onChange: (walletId: string) => void;
  readonly currency?: Currency;
}) {
  const { money } = useI18n();
  const choices = currency ? wallets.filter((wallet) => wallet.currency === currency) : wallets;
  const only = choices.length === 1 ? choices[0] : undefined;
  // With one possible wallet there is nothing to choose: make sure it is the
  // value, and show it as text.
  useEffect(() => {
    if (only && value !== only.id) onChange(only.id);
  }, [only?.id, value]);
  if (only) {
    return (
      <div className="cr-field">
        <span className="cr-label">{label}</span>
        <p className="cr-field-static"><bdi>{only.name}</bdi>{` — ${money(only.balance, only.currency)}`}</p>
      </div>
    );
  }
  return (
    <SelectField label={label} value={value} required onChange={(event) => onChange(event.target.value)}>
        {choices.map((wallet) => (
          <option key={wallet.id} value={wallet.id}>{`${wallet.name} — ${money(wallet.balance, wallet.currency)}`}</option>
        ))}
      </SelectField>
  );
}

export const READY = '';

/** Plan items grouped like the plan; optionally offers Ready to assign (value ''). */
export function ItemSelect({ label, groups, value, onChange, currency, includeReady = false, readyBalance, exclude }: {
  readonly label: string;
  readonly groups: readonly PickerGroup[];
  readonly value: string;
  readonly onChange: (itemId: string) => void;
  readonly currency: Currency;
  readonly includeReady?: boolean;
  readonly readyBalance?: bigint;
  readonly exclude?: string;
}) {
  const { t, money, name } = useI18n();
  return (
    <SelectField label={label} value={value} required={!includeReady} onChange={(event) => onChange(event.target.value)}>
        {includeReady ? (
          <option value={READY}>{readyBalance === undefined ? t('common.readyToAssign') : `${t('common.readyToAssign')} — ${money(readyBalance, currency)}`}</option>
        ) : (
          <option value="" disabled>{t('record.chooseItem')}</option>
        )}
        {groups.map((group) => (
          <optgroup key={group.groupId} label={name(group)}>
            {group.items.filter((item) => item.itemId !== exclude).map((item) => (
              <option key={item.itemId} value={item.itemId}>{`${name(item)} — ${money(item.balances[currency], currency)}`}</option>
            ))}
          </optgroup>
        ))}
      </SelectField>
  );
}

export function DateField({ value, onChange, max, label }: { readonly value: string; readonly onChange: (date: string) => void; readonly max: string; readonly label?: string }) {
  const { t } = useI18n();
  return (
    <label className="cr-field">
      <span className="cr-label">{label ?? t('common.date')}</span>
      <input type="date" required value={value} max={max} dir="ltr" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Preview({ children }: { readonly children: ReactNode }) {
  const { locale } = useI18n();
  return <section className="cr-record-preview" aria-label={locale === 'ar' ? 'معاينة' : 'Preview'}><strong>{locale === 'ar' ? 'معاينة' : 'Preview'}</strong>{children}</section>;
}

export function NoteField({ value, onChange }: { readonly value: string; readonly onChange: (note: string) => void }) {
  const { t } = useI18n();
  return (
    <details className="cr-record-details"><summary>{t('common.note')}</summary><label className="cr-field">
      <span className="cr-label">{t('common.note')}</span>
      <input type="text" maxLength={200} value={value} onChange={(event) => onChange(event.target.value)} />
    </label></details>
  );
}

export function FormActions({ submitLabel, submitText, pending, onCancel, disabled = false }: {
  readonly submitLabel: MessageKey;
  readonly submitText?: string | undefined;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="dialog-actions">
      <button type="button" className="cr-button" onClick={onCancel} disabled={pending}>{t('common.cancel')}</button>
      <button type="submit" className="cr-button cr-button--primary" disabled={pending || disabled}>
        {pending ? t('common.saving') : (submitText ?? t(submitLabel))}
      </button>
    </div>
  );
}

export function Explain({ children, tone = 'info' }: { readonly children: ReactNode; readonly tone?: 'info' | 'warn' }) {
  return <p className={tone === 'warn' ? 'cr-explain cr-explain--warn' : 'cr-explain'} role="status">{children}</p>;
}

/** How much more than an item holds an outflow takes (0 when it fits). */
export function shortfallOf(catalog: Catalog, itemId: string, currency: Currency, amount: bigint | null): bigint {
  const item = itemId ? findItem(catalog.plan, itemId) : null;
  if (!item || amount === null) return 0n;
  const available = item.balances[currency] > 0n ? item.balances[currency] : 0n;
  return amount > available ? amount - available : 0n;
}

/**
 * The overspending rule, said out loud: when an outflow is bigger than its
 * item, the difference comes from Ready to assign or an item the person picks,
 * in the same currency, at the moment it is recorded.
 */
export function CoverChoice({ catalog, itemId, currency, amount, value, onChange }: {
  readonly catalog: Catalog;
  readonly itemId: string;
  readonly currency: Currency;
  readonly amount: bigint | null;
  readonly value: string;
  readonly onChange: (itemId: string) => void;
}) {
  const { t, money, name } = useI18n();
  const item = itemId ? findItem(catalog.plan, itemId) : null;
  const shortfall = shortfallOf(catalog, itemId, currency, amount);
  if (!item || shortfall === 0n) return null;
  const available = item.balances[currency] > 0n ? item.balances[currency] : 0n;
  const ready = catalog.ready[currency];
  const groups = pickerGroups(catalog.plan).map((group) => ({ ...group, items: group.items.filter((candidate) => candidate.balances[currency] >= shortfall) }));
  return (
    <div className="cr-cover">
      <Explain tone="warn">{t('record.shortfall', { name: name(item), available: money(available, currency), shortfall: money(shortfall, currency) })}</Explain>
      <ItemSelect label={t('record.coverFrom')} groups={groups} value={value} onChange={onChange} currency={currency} includeReady readyBalance={ready} exclude={itemId} />
      {value === READY && ready < shortfall ? (
        <Explain tone="warn">{t('record.willOverAssign', { amount: money(shortfall - (ready > 0n ? ready : 0n), currency) })}</Explain>
      ) : null}
    </div>
  );
}

/** Appends "X was covered from …" when the database moved money to cover a shortfall. */
export function withCovered(i18n: I18n, message: string, covered: bigint | undefined, currency: Currency): string {
  return covered && covered > 0n ? `${message} ${i18n.t('record.coveredNote', { amount: i18n.money(covered, currency) })}` : message;
}
