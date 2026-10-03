import { useId, useRef, useState, type FormEvent } from 'react';

import type { Locale } from '../loans/types.js';
import { DialogShell } from '../wallets/dialog-shell.js';
import { findMatchingCategory, namesCollide } from './category-name-rules.js';
import { CATEGORY_PACKS, MAX_PACK_SELECTION, flatSuggestions, type CategoryPack } from './category-packs.js';
import { classifyCategoryError, localizeCategoryError } from './errors.js';
import type { Category, CategoryKind } from './types.js';
import { normalizeCategoryDraft, type CategoryCommandOutcome, type CreateCategoryDraft } from './use-categories.js';

interface CategoryPackDialogProps {
  locale: Locale;
  /** Loaded active categories, used to surface an existing normalized-name collision. */
  existingCategories: readonly Category[];
  /** Runs the existing create-category command with a caller-owned request UUID. */
  onCreateCategory(draft: CreateCategoryDraft, requestId: string): Promise<CategoryCommandOutcome>;
  onClose(): void;
  /** Injectable for tests; defaults to a fresh session UUID. */
  createRequestId?(): string;
  /** Injectable for tests; defaults to the static version-1 packs. */
  packs?: readonly CategoryPack[];
}

type RowStatus = 'idle' | 'creating' | 'created' | 'skipped' | 'failed';

interface PackRow {
  key: string;
  packId: string;
  kind: CategoryKind;
  /** Immutable suggestion label, always shown in the preview legend. */
  suggestionNameEn: string;
  suggestionNameAr: string;
  /** Editable, normalized through the existing category rules on submit. */
  nameEn: string;
  nameAr: string;
  selected: boolean;
  status: RowStatus;
  existingCategoryId: string | null;
  existingNameEn: string | null;
  existingNameAr: string | null;
  existingKind: CategoryKind | null;
  error: string | null;
}

/** A normalized-name candidate: an existing category or one already created this run. */
interface KnownName {
  kind: CategoryKind;
  nameEn: string | null;
  nameAr: string | null;
  categoryId: string | null;
}

const t = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en;

function buildRows(packs: readonly CategoryPack[]): PackRow[] {
  return flatSuggestions(packs).map((suggestion) => ({
    key: suggestion.id,
    packId: suggestion.id.split('.')[0] ?? suggestion.id,
    kind: suggestion.kind,
    suggestionNameEn: suggestion.nameEn,
    suggestionNameAr: suggestion.nameAr,
    nameEn: suggestion.nameEn,
    nameAr: suggestion.nameAr,
    selected: false,
    status: 'idle',
    existingCategoryId: null,
    existingNameEn: null,
    existingNameAr: null,
    existingKind: null,
    error: null,
  }));
}

function suggestionLabel(row: PackRow, locale: Locale): string {
  return locale === 'ar' ? row.suggestionNameAr : row.suggestionNameEn;
}

function rowLabel(row: PackRow, locale: Locale): string {
  return locale === 'ar' ? row.nameAr || row.nameEn : row.nameEn || row.nameAr;
}

function kindLabel(locale: Locale, kind: CategoryKind | null): string {
  if (kind === 'income') return t(locale, 'Income', 'دخل');
  if (kind === 'expense') return t(locale, 'Expense', 'مصروف');
  return '';
}

function statusLabel(locale: Locale, status: RowStatus): string {
  if (status === 'created') return t(locale, 'Created', 'منشأة');
  if (status === 'skipped') return t(locale, 'Skipped', 'متجاوزة');
  if (status === 'failed') return t(locale, 'Failed', 'فاشلة');
  return t(locale, 'Creating…', 'جارٍ الإنشاء…');
}

function errorCopy(locale: Locale, cause: unknown): string {
  const error = localizeCategoryError(classifyCategoryError(cause), locale);
  return `${error.message} ${error.recovery}`;
}

export function CategoryPackDialog(props: CategoryPackDialogProps) {
  const descriptionId = useId();
  const packs = props.packs ?? CATEGORY_PACKS;
  const createRequestId = props.createRequestId ?? (() => globalThis.crypto.randomUUID());
  const [rows, setRows] = useState<PackRow[]>(() => buildRows(packs));
  const [phase, setPhase] = useState<'select' | 'results'>('select');
  const [running, setRunning] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  // One request UUID per entry, created lazily and reused on every retry so a
  // retried entry never receives a new id. Nothing here is persisted anywhere.
  const requestIds = useRef(new Map<string, string>());
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const existingRef = useRef(props.existingCategories);
  existingRef.current = props.existingCategories;

  const selectedCount = rows.filter((row) => row.selected).length;
  const atCap = selectedCount >= MAX_PACK_SELECTION;
  const createdCount = rows.filter((row) => row.status === 'created').length;
  const skippedCount = rows.filter((row) => row.status === 'skipped').length;
  const failedCount = rows.filter((row) => row.status === 'failed').length;
  const processed = rows.filter((row) => row.status !== 'idle');

  function updateRow(key: string, patch: Partial<PackRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function requestIdFor(key: string): string {
    const existing = requestIds.current.get(key);
    if (existing !== undefined) return existing;
    const created = createRequestId();
    requestIds.current.set(key, created);
    return created;
  }

  function toggle(key: string, selected: boolean) {
    setSelectionError(null);
    updateRow(key, { selected });
  }

  function editName(key: string, field: 'nameEn' | 'nameAr', value: string) {
    updateRow(key, { [field]: value });
  }

  async function run(targetKeys: readonly string[]) {
    if (targetKeys.length === 0) return;
    setRunning(true);
    setPhase('results');
    setRows((current) => current.map((row) => (targetKeys.includes(row.key) ? { ...row, status: 'creating' } : row)));
    const snapshot = rowsRef.current;
    const known: KnownName[] = existingRef.current
      .filter((category) => category.archivedAt === null)
      .map((category) => ({ kind: category.kind, nameEn: category.nameEn, nameAr: category.nameAr, categoryId: category.id }));

    for (const key of targetKeys) {
      const row = snapshot.find((candidate) => candidate.key === key);
      if (!row) continue;

      const collision = known.find((candidate) => candidate.kind === row.kind && namesCollide(row, candidate));
      if (collision) {
        updateRow(key, {
          status: 'skipped',
          existingCategoryId: collision.categoryId,
          existingNameEn: collision.nameEn,
          existingNameAr: collision.nameAr,
          existingKind: collision.kind,
          error: null,
        });
        continue;
      }

      let normalized: CreateCategoryDraft;
      try {
        normalized = normalizeCategoryDraft({ kind: row.kind, nameEn: row.nameEn, nameAr: row.nameAr });
      } catch (cause) {
        updateRow(key, {
          status: 'failed',
          existingCategoryId: null,
          existingNameEn: null,
          existingNameAr: null,
          existingKind: null,
          error: errorCopy(props.locale, cause),
        });
        continue;
      }

      try {
        const outcome = await props.onCreateCategory(normalized, requestIdFor(key));
        if (outcome.status === 'ambiguous') {
          updateRow(key, {
            status: 'failed',
            error: t(props.locale,
              'The result is still unknown. We found no matching category command; retry only these unchanged labels.',
              'ما زالت النتيجة غير معروفة. لم نجد أمر فئة مطابقًا؛ أعد المحاولة بنفس التسميات دون تغيير.',
            ),
          });
        } else {
          updateRow(key, { status: 'created', error: null });
          known.push({ kind: normalized.kind, nameEn: normalized.nameEn, nameAr: normalized.nameAr, categoryId: null });
        }
      } catch (cause) {
        const view = classifyCategoryError(cause);
        if (view.code === 'duplicate_name') {
          // A residual server-side collision: surface the (possibly refreshed)
          // existing category when it can be matched, never a retryable failure.
          const match = findMatchingCategory({ kind: row.kind, nameEn: row.nameEn, nameAr: row.nameAr }, existingRef.current);
          updateRow(key, {
            status: 'skipped',
            existingCategoryId: match?.id ?? null,
            existingNameEn: match?.nameEn ?? null,
            existingNameAr: match?.nameAr ?? null,
            existingKind: match?.kind ?? null,
            error: null,
          });
        } else {
          updateRow(key, {
            status: 'failed',
            existingCategoryId: null,
            existingNameEn: null,
            existingNameAr: null,
            existingKind: null,
            error: errorCopy(props.locale, cause),
          });
        }
      }
    }
    setRunning(false);
  }

  function retryFailed() {
    void run(rowsRef.current.filter((row) => row.status === 'failed').map((row) => row.key));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const selected = rowsRef.current.filter((row) => row.selected);
    if (selected.length === 0) {
      setSelectionError(t(props.locale, 'Select at least one suggestion to add.', 'اختر اقتراحًا واحدًا على الأقل للإضافة.'));
      return;
    }
    if (selected.some((row) => row.nameEn.trim() === '' && row.nameAr.trim() === '')) {
      setSelectionError(t(props.locale,
        'Enter at least one category name for each selected suggestion.',
        'أدخل اسمًا واحدًا على الأقل لكل اقتراح محدد.',
      ));
      return;
    }
    setSelectionError(null);
    void run(selected.slice(0, MAX_PACK_SELECTION).map((row) => row.key));
  }

  const title = t(props.locale, 'Add suggestion pack', 'إضافة حزمة اقتراحات');
  const closeLabel = t(props.locale, 'Close', 'إغلاق');

  if (phase === 'results') {
    return <DialogShell title={title} closeLabel={closeLabel} onClose={props.onClose} pending={running} wide descriptionId={descriptionId}>
      <div className="dialog-result cg-result cg-pack-result">
        <strong>{t(props.locale, 'Suggestion pack processed', 'تمت معالجة حزمة الاقتراحات')}</strong>
        <p id={descriptionId} role="status" className="cg-pack-summary">{t(props.locale,
          `${createdCount} created, ${skippedCount} skipped, ${failedCount} failed`,
          `${createdCount} منشأة، ${skippedCount} متجاوزة، ${failedCount} فاشلة`,
        )}</p>
        <ul className="cg-pack-results">
          {processed.map((row) => <li key={row.key} className="cg-pack-result-row" data-status={row.status}>
            <bdi>{rowLabel(row, props.locale)}</bdi>
            <span className="cg-pack-status">{statusLabel(props.locale, row.status)}</span>
            {row.status === 'skipped' && row.existingCategoryId
              ? <span className="cg-pack-existing"><span className="cg-pack-existing-label">{t(props.locale, 'Existing category', 'فئة موجودة')}</span>{' '}<bdi>{props.locale === 'ar' ? row.existingNameAr ?? row.existingNameEn : row.existingNameEn ?? row.existingNameAr}</bdi>{' '}<span className="cg-pack-kind">({kindLabel(props.locale, row.existingKind)})</span></span>
              : null}
            {row.status === 'failed' && row.error ? <span className="cg-pack-error">{row.error}</span> : null}
          </li>)}
        </ul>
        <div className="dialog-actions">
          {failedCount > 0
            ? <button type="button" className="button-secondary cg-pack-retry" disabled={running} onClick={retryFailed}>{t(props.locale, 'Retry failed categories', 'إعادة الفئات الفاشلة')}</button>
            : null}
          <button type="button" className="cr-button cr-button--primary" data-autofocus disabled={running} onClick={props.onClose}>{t(props.locale, 'Done', 'تم')}</button>
        </div>
      </div>
    </DialogShell>;
  }

  return <DialogShell title={title} closeLabel={closeLabel} onClose={props.onClose} pending={running} wide descriptionId={descriptionId}>
    <form className="dialog-form cg-form cg-pack-form" onSubmit={submit} aria-describedby={descriptionId}>
      <p id={descriptionId} className="dialog-intro dialog-consequence">{t(props.locale,
        'Optional starting points for this space. Nothing is added until you choose and confirm — these are suggestions, not required categories.',
        'نقاط بداية اختيارية لهذه المساحة. لا يُضاف أي شيء حتى تختار وتؤكد — هذه اقتراحات وليست فئات إلزامية.',
      )}</p>
      {selectionError && <div className="error-notice" role="alert">{selectionError}</div>}
      <p className="cg-pack-cap">{t(props.locale, `Up to ${MAX_PACK_SELECTION} suggestions at a time.`, `حتى ${MAX_PACK_SELECTION} اقتراحات في المرة الواحدة.`)}</p>
      {packs.map((pack) => <section key={pack.id} className="cg-pack" aria-label={props.locale === 'ar' ? pack.nameAr : pack.nameEn}>
        <h3 className="cg-pack-title">{props.locale === 'ar' ? pack.nameAr : pack.nameEn}</h3>
        <ul className="cg-pack-list">
          {rows.filter((row) => row.packId === pack.id).map((row) => <li key={row.key} className="cg-pack-item">
            <fieldset className="cg-pack-entry">
              <legend className="cg-pack-legend"><bdi>{suggestionLabel(row, props.locale)}</bdi></legend>
              <label className="cg-pack-choice">
                <input
                  type="checkbox"
                  checked={row.selected}
                  disabled={running || (!row.selected && atCap)}
                  aria-label={t(props.locale, `Include ${row.suggestionNameEn}`, `تضمين ${row.suggestionNameAr}`)}
                  onChange={(event) => toggle(row.key, event.target.checked)}
                />
                <span>{t(props.locale, 'Include', 'تضمين')}</span>
              </label>
              <div className="cg-pack-fields">
                <label>{t(props.locale, 'English name', 'الاسم بالعربية')}<input name={props.locale === 'ar' ? 'nameAr' : 'nameEn'} dir={props.locale === 'ar' ? 'rtl' : 'ltr'} maxLength={120} value={props.locale === 'ar' ? row.nameAr : row.nameEn} disabled={running || !row.selected} onChange={(event) => editName(row.key, props.locale === 'ar' ? 'nameAr' : 'nameEn', event.target.value)} /></label>
              </div>
            </fieldset>
          </li>)}
        </ul>
      </section>)}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={running} onClick={props.onClose}>{t(props.locale, 'Cancel', 'إلغاء')}</button>
        <button type="submit" className="cr-button cr-button--primary cg-pack-submit" disabled={running}>{running ? t(props.locale, 'Adding…', 'جارٍ الإضافة…') : t(props.locale, 'Add selected categories', 'إضافة الفئات المحددة')}</button>
      </div>
    </form>
  </DialogShell>;
}
