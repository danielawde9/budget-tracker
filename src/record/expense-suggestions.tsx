import { useId } from 'react';
import type { ExpenseSuggestion, ExpenseSuggestions } from '../api/schemas.ts';
import { findItem, useWorkspace, type Catalog } from '../app/workspace.tsx';
import { useI18n } from '../lib/i18n.tsx';
import { useLoad, type Loaded } from '../ui/async.tsx';

/**
 * The person's past expense descriptions, loaded when the form opens.
 * Loaded on their own so a failure here never blocks recording.
 */
export function useExpenseSuggestions(): Loaded<ExpenseSuggestions> {
  const { api, space } = useWorkspace();
  return useLoad(() => api.expenseSuggestions(space.id), [api, space.id]);
}

/** The suggestion whose description is exactly this text, ignoring case and outer spaces. */
export function matchSuggestion(loaded: Loaded<ExpenseSuggestions>, text: string): ExpenseSuggestion | null {
  const wanted = text.trim().toLowerCase();
  if (wanted === '') return null;
  return loaded.data?.suggestions.find((suggestion) => suggestion.memo.toLowerCase() === wanted) ?? null;
}

/**
 * Free text with the past descriptions as a native dropdown (`<datalist>`):
 * the browser filters as you type and supplies keyboard and screen-reader
 * support. Picking one is just typing it in full; the form decides what that
 * fills.
 */
export function DescriptionField({ value, onChange, suggestions, catalog, autoFocus }: {
  readonly value: string;
  readonly onChange: (memo: string) => void;
  /** Null when there is nothing to suggest (paying a bill). */
  readonly suggestions: Loaded<ExpenseSuggestions> | null;
  readonly catalog: Catalog;
  readonly autoFocus: boolean;
}) {
  const { t, money, name } = useI18n();
  const listId = useId();
  const hintId = useId();
  const options = suggestions?.status === 'ready' ? suggestions.data.suggestions : [];
  const hint = suggestions?.status === 'error' ? t('record.suggestionsFailed') : options.length > 0 ? t('record.descriptionHint') : null;
  return (
    <>
      <label className="cr-field">
        <span className="cr-label">{t('record.description')}</span>
        <input
          type="text"
          maxLength={200}
          autoComplete="off"
          list={options.length > 0 ? listId : undefined}
          aria-describedby={hint ? hintId : undefined}
          data-autofocus={autoFocus ? '' : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((suggestion) => {
            const item = findItem(catalog.plan, suggestion.itemId);
            const amount = money(suggestion.amount, suggestion.currency);
            return <option key={suggestion.memo} value={suggestion.memo}>{item ? `${name(item)} · ${amount}` : amount}</option>;
          })}
        </datalist>
      ) : null}
      {hint ? <p id={hintId} className="cr-helper">{hint}</p> : null}
    </>
  );
}
