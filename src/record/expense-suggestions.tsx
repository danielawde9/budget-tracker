import { useId, useRef, useState } from 'react';
import { ArrowUpLeft } from 'lucide-react';
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
 * Past expenses stay in the scrollable form, so suggestions cannot cover the
 * keyboard or escape the dialog. Each suggestion is a normal keyboard-accessible button.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const hintId = useId();
  const options = suggestions?.status === 'ready' ? suggestions.data.suggestions : [];
  const query = value.trim().toLocaleLowerCase();
  const exactMatch = options.some(suggestion => suggestion.memo.toLocaleLowerCase() === query);
  const matches = exactMatch ? []
    : options.filter(suggestion => suggestion.memo.toLocaleLowerCase().includes(query)).slice(0, 3);
  const visible = focused && !dismissed && matches.length > 0;
  const hint = suggestions?.status === 'error' ? t('record.suggestionsFailed') : options.length > 0 && !exactMatch ? t('record.descriptionHint') : null;
  return (
    <div className="cr-description-field" onFocus={() => setFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}>
      <label className="cr-field">
        <span className="cr-label">{t('record.description')}</span>
        <input
          ref={inputRef}
          type="text"
          maxLength={200}
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (!visible || event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); }
            if (event.key === 'ArrowDown') { event.preventDefault(); listRef.current?.querySelector('button')?.focus(); }
          }}
          aria-describedby={hint ? hintId : undefined}
          data-autofocus={autoFocus ? '' : undefined}
          value={value}
          onChange={(event) => { setDismissed(false); onChange(event.target.value); }}
        />
      </label>
      {visible ? (
        <div ref={listRef} className="cr-description-suggestions" role="group" aria-label={t('record.pastExpenses')}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); inputRef.current?.focus(); }
          }}>
          {matches.map((suggestion) => {
            const item = findItem(catalog.plan, suggestion.itemId);
            const amount = money(suggestion.amount, suggestion.currency);
            return <button type="button" key={suggestion.memo}
              onPointerDown={event => event.preventDefault()}
              onFocus={() => setFocused(true)}
              onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) setFocused(false); }}
              onClick={() => { onChange(suggestion.memo); setDismissed(true); inputRef.current?.focus(); }}>
              <span className="cr-suggestion-copy"><strong>{suggestion.memo}</strong>{item ? <span>{name(item)}</span> : null}</span>
              <bdi className="cr-suggestion-amount" dir="ltr">{amount}</bdi>
              <ArrowUpLeft size={16} aria-hidden="true" />
            </button>;
          })}
        </div>
      ) : null}
      {hint ? <p id={hintId} className="cr-helper">{hint}</p> : null}
    </div>
  );
}
