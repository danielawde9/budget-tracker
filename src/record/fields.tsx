import type { ReactNode } from 'react';
import type { AccountWallet } from '../api/schemas.ts';
import type { PickerGroup } from '../app/workspace.tsx';
import { useI18n, type MessageKey } from '../lib/i18n.tsx';
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

export function NoteField({ value, onChange }: { readonly value: string; readonly onChange: (note: string) => void }) {
  const { t } = useI18n();
  return (
    <label className="cr-field">
      <span className="cr-label">{t('common.note')}</span>
      <input type="text" maxLength={200} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function FormActions({ submitLabel, pending, onCancel, disabled = false }: {
  readonly submitLabel: MessageKey;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="dialog-actions">
      <button type="button" className="cr-button" onClick={onCancel} disabled={pending}>{t('common.cancel')}</button>
      <button type="submit" className="cr-button cr-button--primary" disabled={pending || disabled}>
        {pending ? t('common.saving') : t(submitLabel)}
      </button>
    </div>
  );
}

export function Explain({ children, tone = 'info' }: { readonly children: ReactNode; readonly tone?: 'info' | 'warn' }) {
  return <p className={tone === 'warn' ? 'cr-explain cr-explain--warn' : 'cr-explain'} role="status">{children}</p>;
}
