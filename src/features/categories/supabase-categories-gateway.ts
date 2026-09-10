import type {
  ArchiveCategoryInput,
  CategoriesGateway,
  Category,
  CategoryCommandKind,
  CategoryCommandResult,
  CategoryKind,
  CategorizedEventInput,
  CreateSubcategoryInput,
  EventCategory,
} from './types.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_EVENT_PAGE_SIZE = 20;

interface DataError {
  message: string;
  code?: string;
}

interface DataResult {
  data: unknown[] | null;
  error: DataError | null;
}

export interface CategoriesQueryBuilder {
  select(columns?: string): CategoriesQueryBuilder;
  eq(column: string, value: unknown): CategoriesQueryBuilder;
  is(column: string, value: null): CategoriesQueryBuilder;
  in(column: string, values: readonly unknown[]): CategoriesQueryBuilder;
  or(filters: string): CategoriesQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): CategoriesQueryBuilder;
  limit(count: number): Promise<DataResult>;
}

export interface CategoriesDataClient {
  from(relation: string): CategoriesQueryBuilder;
  rpc(name: string, args: Record<string, unknown>): Promise<DataResult>;
}

type Row = Record<string, unknown>;
type MutationName = 'create_category' | 'create_subcategory' | 'archive_category' | 'record_categorized_financial_event';

const categoryKinds = new Set<CategoryKind>(['income', 'expense']);
const commandKinds = new Set<CategoryCommandKind>(['create_category', 'create_subcategory', 'archive_category']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The database returned an invalid category row.');
  }
  return value as Row;
}

function textValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') throw new Error(`The category row is missing ${key}.`);
  return result;
}

function nullableText(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== 'string') throw new Error(`The category row has invalid ${key}.`);
  return result;
}

function uuidValue(value: Row, key: string): string {
  const result = textValue(value, key);
  if (!uuidPattern.test(result)) throw new Error(`The category row has invalid ${key}.`);
  return result;
}

function nullableUuid(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== 'string' || !uuidPattern.test(result)) {
    throw new Error(`The category row has invalid ${key}.`);
  }
  return result;
}

function validTimestamp(value: string): boolean {
  const match = timestampPattern.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetHour = '00', offsetMinute = '00'] = match;
  const numbers = [year, month, day, hour, minute, second, offsetHour, offsetMinute].map(Number);
  const [y, m, d, h, min, s, oh, om] = numbers;
  if (h! > 23 || min! > 59 || s! > 59 || oh! > 23 || om! > 59) return false;
  const calendar = new Date(Date.UTC(y!, m! - 1, d!));
  return calendar.getUTCFullYear() === y && calendar.getUTCMonth() === m! - 1 && calendar.getUTCDate() === d;
}

function timestampValue(value: Row, key: string): string {
  const result = textValue(value, key);
  if (!validTimestamp(result)) throw new Error(`The category row has invalid ${key}.`);
  return result;
}

function nullableTimestamp(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== 'string' || !validTimestamp(result)) {
    throw new Error(`The category row has invalid ${key}.`);
  }
  return result;
}

function categoryKind(value: Row, key = 'kind'): CategoryKind {
  const result = textValue(value, key) as CategoryKind;
  if (!categoryKinds.has(result)) throw new Error('The category row has an unsupported kind.');
  return result;
}

function commandKind(value: Row): CategoryCommandKind {
  const result = textValue(value, 'command_kind') as CategoryCommandKind;
  if (!commandKinds.has(result)) throw new Error('The category result has an unsupported command kind.');
  return result;
}

async function rows(resultPromise: Promise<DataResult>, label: string, maximum: number): Promise<Row[]> {
  const result = await resultPromise;
  if (result.error) throw result.error;
  const values = result.data ?? [];
  if (values.length > maximum) throw new Error(`${label} exceeded its ${maximum}-row read bound.`);
  return values.map(asRow);
}

function pageSize(value: number | undefined): number {
  const result = value ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_PAGE_SIZE) {
    throw new Error('The category page size must be between 1 and 100.');
  }
  return result;
}

function encodeCursor(category: Category): string {
  return btoa(JSON.stringify({ createdAt: category.createdAt, id: category.id }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const value = JSON.parse(atob(`${base64}${padding}`)) as Record<string, unknown>;
    const createdAt = typeof value['createdAt'] === 'string' ? value['createdAt'] : '';
    const id = typeof value['id'] === 'string' ? value['id'] : '';
    if (!validTimestamp(createdAt) || !uuidPattern.test(id)) throw new Error('invalid');
    return { createdAt, id };
  } catch {
    throw new Error('The category cursor is invalid.');
  }
}

function parseCategory(value: Row, spaceId: string, expectedKind?: CategoryKind, requireActive = false): Category {
  if (textValue(value, 'space_id') !== spaceId) throw new Error('A category escaped the selected space.');
  const kind = categoryKind(value);
  if (expectedKind && kind !== expectedKind) throw new Error('A category escaped the selected kind.');
  const nameEn = nullableText(value, 'name_en');
  const nameAr = nullableText(value, 'name_ar');
  if (!nameEn && !nameAr) throw new Error('A category row has no display name.');
  const archivedAt = nullableTimestamp(value, 'archived_at');
  if (requireActive && archivedAt !== null) throw new Error('An active category row is archived.');
  return {
    id: uuidValue(value, 'id'),
    spaceId,
    kind,
    nameEn,
    nameAr,
    parentCategoryId: nullableUuid(value, 'parent_category_id'),
    createdAt: timestampValue(value, 'created_at'),
    archivedAt,
  };
}

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function idResult(data: unknown[] | null, key: 'id' | 'eventId'): { id?: string; eventId?: string } {
  if (data?.length !== 1) throw new Error('The category command must return exactly one result.');
  const id = uuidValue(asRow(data[0]), 'id');
  return key === 'id' ? { id } : { eventId: id };
}

export function createSupabaseCategoriesGateway(client: CategoriesDataClient): CategoriesGateway {
  async function runCommand(name: MutationName, args: Record<string, unknown>) {
    const result = await client.rpc(name, args);
    if (result.error) throw result.error;
    return idResult(result.data, name === 'record_categorized_financial_event' ? 'eventId' : 'id');
  }

  return {
    async listCategories(spaceId, kind, cursor, requestedLimit) {
      const limit = pageSize(requestedLimit);
      let query = client.from('categories')
        .select('id,space_id,kind,name_en,name_ar,parent_category_id,created_at,archived_at')
        .eq('space_id', spaceId)
        .eq('kind', kind)
        .is('archived_at', null);
      if (cursor) {
        const decoded = decodeCursor(cursor);
        query = query.or(`created_at.gt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.gt.${decoded.id})`);
      }
      const values = await rows(
        query.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit + 1),
        'Categories',
        limit + 1,
      );
      const hasMore = values.length > limit;
      const categories = values.slice(0, limit).map((value) => parseCategory(value, spaceId, kind, true));
      const last = categories.at(-1);
      return { categories, nextCursor: hasMore && last ? encodeCursor(last) : null };
    },

    createCategory(input) {
      return runCommand('create_category', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_kind: input.kind,
        p_name_en: trimmedOrNull(input.nameEn),
        p_name_ar: trimmedOrNull(input.nameAr),
      });
    },

    createSubcategory(input: CreateSubcategoryInput) {
      return runCommand('create_subcategory', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_parent_category_id: input.parentCategoryId,
        p_name_en: trimmedOrNull(input.nameEn),
        p_name_ar: trimmedOrNull(input.nameAr),
      });
    },

    archiveCategory(input: ArchiveCategoryInput) {
      return runCommand('archive_category', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_category_id: input.categoryId,
      });
    },

    async getCommandResult(spaceId, requestId) {
      const values = await rows(
        client.rpc('get_category_command_result', { p_space_id: spaceId, p_request_id: requestId }),
        'Category command reconciliation',
        1,
      );
      const value = values[0];
      if (!value) return null;
      return {
        commandKind: commandKind(value),
        categoryId: uuidValue(value, 'category_id'),
        createdAt: timestampValue(value, 'created_at'),
      } satisfies CategoryCommandResult;
    },

    recordCategorizedEvent(input: CategorizedEventInput) {
      if (!categoryKinds.has(input.kind)) {
        return Promise.reject(new Error('Only income and expense events may be categorized.'));
      }
      return runCommand('record_categorized_financial_event', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_kind: input.kind,
        p_effective_date: input.effectiveDate,
        p_movements: input.movements,
        p_category_id: input.categoryId,
      });
    },

    async findCategorizedEventByRequestId(spaceId, requestId) {
      const events = await rows(
        client.from('financial_events').select('id,space_id,request_id')
          .eq('space_id', spaceId).eq('request_id', requestId).limit(2),
        'Categorized event reconciliation',
        1,
      );
      const event = events[0];
      if (!event) return null;
      if (textValue(event, 'space_id') !== spaceId || textValue(event, 'request_id') !== requestId) {
        throw new Error('A reconciled event escaped the requested boundary.');
      }
      const eventId = uuidValue(event, 'id');
      const associations = await rows(
        client.from('financial_event_categories').select('event_id,space_id,category_id')
          .eq('space_id', spaceId).eq('event_id', eventId).limit(2),
        'Categorized event association reconciliation',
        1,
      );
      const association = associations[0];
      if (!association) return null;
      if (textValue(association, 'space_id') !== spaceId || uuidValue(association, 'event_id') !== eventId) {
        throw new Error('A reconciled category association escaped the requested boundary.');
      }
      return { eventId, categoryId: uuidValue(association, 'category_id') };
    },

    async resolveEventCategories(spaceId, eventIds) {
      const uniqueEventIds = [...new Set(eventIds)];
      if (uniqueEventIds.length > MAX_EVENT_PAGE_SIZE) {
        throw new Error('Category history resolution accepts at most 20 event IDs.');
      }
      if (uniqueEventIds.length === 0) return [];
      const associations = await rows(
        client.from('financial_event_categories')
          .select('event_id,space_id,category_id,category_kind')
          .eq('space_id', spaceId).in('event_id', uniqueEventIds).limit(MAX_EVENT_PAGE_SIZE + 1),
        'Financial event categories',
        MAX_EVENT_PAGE_SIZE,
      );
      if (associations.length === 0) return [];
      const categoryIds = [...new Set(associations.map((value) => uuidValue(value, 'category_id')))];
      const categories = await rows(
        client.from('categories').select('id,space_id,kind,name_en,name_ar,parent_category_id,created_at,archived_at')
          .eq('space_id', spaceId).in('id', categoryIds).limit(MAX_EVENT_PAGE_SIZE + 1),
        'Historical categories',
        MAX_EVENT_PAGE_SIZE,
      );
      const categoryById = new Map(categories.map((value) => {
        const category = parseCategory(value, spaceId);
        return [category.id, category];
      }));
      return associations.map((value): EventCategory => {
        if (textValue(value, 'space_id') !== spaceId) throw new Error('A category association escaped the selected space.');
        const eventId = uuidValue(value, 'event_id');
        if (!uniqueEventIds.includes(eventId)) throw new Error('A category association escaped the event page.');
        const categoryId = uuidValue(value, 'category_id');
        const category = categoryById.get(categoryId);
        const kind = categoryKind(value, 'category_kind');
        if (!category || category.kind !== kind) throw new Error('A category association has no matching category.');
        return {
          eventId,
          categoryId,
          categoryKind: kind,
          nameEn: category.nameEn,
          nameAr: category.nameAr,
          archivedAt: category.archivedAt,
        };
      });
    },
  };
}
