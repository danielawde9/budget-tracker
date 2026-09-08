import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createSupabaseCategoriesGateway,
  type CategoriesDataClient,
  type CategoriesQueryBuilder,
} from './supabase-categories-gateway.js';

type Result = { data: unknown[] | null; error: { message: string; code?: string } | null };
type Operation = { relation: string; name: string; args: readonly unknown[] };

class RecordingBuilder implements CategoriesQueryBuilder {
  constructor(
    private readonly relation: string,
    private readonly result: Result,
    private readonly operations: Operation[],
  ) {}

  private record(name: string, ...args: unknown[]): this {
    this.operations.push({ relation: this.relation, name, args });
    return this;
  }

  select(columns = '*') { return this.record('select', columns); }
  eq(column: string, value: unknown) { return this.record('eq', column, value); }
  is(column: string, value: null) { return this.record('is', column, value); }
  in(column: string, values: readonly unknown[]) { return this.record('in', column, values); }
  or(filters: string) { return this.record('or', filters); }
  order(column: string, options?: { ascending?: boolean }) { return this.record('order', column, options); }
  limit(count: number) { this.record('limit', count); return Promise.resolve(this.result); }
}

const categoryRows = [
  {
    id: '11111111-1111-4111-8111-111111111111', space_id: 'space-1', kind: 'income',
    name_en: 'Salary', name_ar: 'راتب', created_at: '2026-09-08T10:00:00.000Z', archived_at: null,
  },
];

function clientWith(overrides: Partial<Record<string, unknown[]>> = {}) {
  const operations: Operation[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const values: Record<string, unknown[]> = {
    categories: categoryRows,
    financial_events: [{ id: 'event-1', space_id: 'space-1', request_id: 'request-1' }],
    financial_event_categories: [{ event_id: 'event-1', space_id: 'space-1', category_id: categoryRows[0]?.id, category_kind: 'income' }],
    ...overrides,
  };
  const client: CategoriesDataClient = {
    from(relation) {
      return new RecordingBuilder(relation, { data: values[relation] ?? [], error: null }, operations);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'get_category_command_result') {
        return { data: [{ command_kind: 'create_category', category_id: categoryRows[0]?.id, created_at: '2026-09-08T10:00:00.000Z' }], error: null };
      }
      return { data: [{ id: name === 'record_categorized_financial_event' ? 'event-new' : categoryRows[0]?.id }], error: null };
    },
  };
  return { client, operations, rpcCalls };
}

describe('Supabase Categories gateway', () => {
  it('loads an active kind with deterministic bounded order and an opaque keyset cursor', async () => {
    const second = {
      ...categoryRows[0], id: '22222222-2222-4222-8222-222222222222',
      name_en: 'Bonus', created_at: '2026-09-08T11:00:00.000Z',
    };
    const { client, operations } = clientWith({ categories: [categoryRows[0]!, second] });
    const gateway = createSupabaseCategoriesGateway(client);
    const first = await gateway.listCategories('space-1', 'income', undefined, 1);

    expect(first.categories).toHaveLength(1);
    expect(first.categories[0]).toMatchObject({ spaceId: 'space-1', kind: 'income', nameEn: 'Salary', nameAr: 'راتب' });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(operations).toContainEqual({ relation: 'categories', name: 'eq', args: ['space_id', 'space-1'] });
    expect(operations).toContainEqual({ relation: 'categories', name: 'eq', args: ['kind', 'income'] });
    expect(operations).toContainEqual({ relation: 'categories', name: 'is', args: ['archived_at', null] });
    expect(operations).toContainEqual({ relation: 'categories', name: 'order', args: ['created_at', { ascending: true }] });
    expect(operations).toContainEqual({ relation: 'categories', name: 'order', args: ['id', { ascending: true }] });
    expect(operations).toContainEqual({ relation: 'categories', name: 'limit', args: [2] });

    operations.length = 0;
    await gateway.listCategories('space-1', 'income', first.nextCursor!, 50);
    expect(operations.find((operation) => operation.name === 'or')?.args[0]).toContain('created_at.gt.2026-09-08T10:00:00.000Z');
    expect(operations.find((operation) => operation.name === 'or')?.args[0]).toContain('id.gt.11111111-1111-4111-8111-111111111111');
  });

  it('enforces category page size and row bounds', async () => {
    const { client } = clientWith({ categories: Array.from({ length: 102 }, (_, index) => ({
      ...categoryRows[0], id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    })) });
    const gateway = createSupabaseCategoriesGateway(client);
    await expect(gateway.listCategories('space-1', 'income', undefined, 101)).rejects.toThrow('between 1 and 100');
    await expect(gateway.listCategories('space-1', 'income', undefined, 100)).rejects.toThrow('101-row read bound');
  });

  it('sends exact lifecycle and categorized-posting RPC payloads', async () => {
    const { client, rpcCalls } = clientWith();
    const gateway = createSupabaseCategoriesGateway(client);
    await gateway.createCategory({ spaceId: 'space-1', requestId: 'create-request', kind: 'expense', nameEn: '  Groceries  ', nameAr: '  بقالة  ' });
    await gateway.archiveCategory({ spaceId: 'space-1', requestId: 'archive-request', categoryId: categoryRows[0]!.id });
    await gateway.recordCategorizedEvent({
      spaceId: 'space-1', requestId: 'event-request', kind: 'expense', effectiveDate: '2026-09-08',
      movements: [{ walletId: 'wallet-1', amountMinor: '-1250' }], categoryId: categoryRows[0]!.id,
    });

    expect(rpcCalls).toEqual([
      { name: 'create_category', args: { p_space_id: 'space-1', p_request_id: 'create-request', p_kind: 'expense', p_name_en: 'Groceries', p_name_ar: 'بقالة' } },
      { name: 'archive_category', args: { p_space_id: 'space-1', p_request_id: 'archive-request', p_category_id: categoryRows[0]!.id } },
      { name: 'record_categorized_financial_event', args: { p_space_id: 'space-1', p_request_id: 'event-request', p_kind: 'expense', p_effective_date: '2026-09-08', p_movements: [{ walletId: 'wallet-1', amountMinor: '-1250' }], p_category_id: categoryRows[0]!.id } },
    ]);
  });

  it('refuses unsupported categorized event kinds before an RPC call', async () => {
    const { client, rpcCalls } = clientWith();
    const gateway = createSupabaseCategoriesGateway(client);
    const unsafe = gateway.recordCategorizedEvent as unknown as (input: Record<string, unknown>) => Promise<unknown>;
    await expect(unsafe({ spaceId: 'space-1', requestId: 'request', kind: 'transfer', effectiveDate: '2026-09-08', movements: [], categoryId: categoryRows[0]!.id })).rejects.toThrow('Only income and expense');
    expect(rpcCalls).toEqual([]);
  });

  it('uses only the protected one-row category result lookup for lifecycle reconciliation', async () => {
    const { client, rpcCalls } = clientWith();
    const result = await createSupabaseCategoriesGateway(client).getCommandResult('space-1', 'request-1');
    expect(result).toEqual({ commandKind: 'create_category', categoryId: categoryRows[0]?.id, createdAt: '2026-09-08T10:00:00.000Z' });
    expect(rpcCalls).toEqual([{ name: 'get_category_command_result', args: { p_space_id: 'space-1', p_request_id: 'request-1' } }]);
  });

  it('reconciles a categorized event through bounded event and association reads', async () => {
    const { client, operations } = clientWith();
    const result = await createSupabaseCategoriesGateway(client).findCategorizedEventByRequestId('space-1', 'request-1');
    expect(result).toEqual({ eventId: 'event-1', categoryId: categoryRows[0]?.id });
    expect(operations).toContainEqual({ relation: 'financial_events', name: 'eq', args: ['space_id', 'space-1'] });
    expect(operations).toContainEqual({ relation: 'financial_events', name: 'eq', args: ['request_id', 'request-1'] });
    expect(operations).toContainEqual({ relation: 'financial_events', name: 'limit', args: [2] });
    expect(operations).toContainEqual({ relation: 'financial_event_categories', name: 'limit', args: [2] });
  });

  it('resolves at most one retained category per event page, including archived labels', async () => {
    const archived = { ...categoryRows[0], archived_at: '2026-09-08T12:00:00.000Z' };
    const { client, operations } = clientWith({ categories: [archived] });
    const result = await createSupabaseCategoriesGateway(client).resolveEventCategories('space-1', ['event-1']);
    expect(result).toEqual([{ eventId: 'event-1', categoryId: archived.id, categoryKind: 'income', nameEn: 'Salary', nameAr: 'راتب', archivedAt: archived.archived_at }]);
    expect(operations).toContainEqual({ relation: 'financial_event_categories', name: 'in', args: ['event_id', ['event-1']] });
    expect(operations).toContainEqual({ relation: 'financial_event_categories', name: 'limit', args: [21] });
    expect(operations).toContainEqual({ relation: 'categories', name: 'in', args: ['id', [archived.id]] });
    expect(operations).not.toContainEqual({ relation: 'categories', name: 'is', args: ['archived_at', null] });
    await expect(createSupabaseCategoriesGateway(client).resolveEventCategories('space-1', Array.from({ length: 21 }, (_, index) => `event-${index}`))).rejects.toThrow('at most 20');
  });

  it('ratchets browser writes and RPCs to the approved Categories boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/categories/supabase-categories-gateway.ts'), 'utf8');
    expect(source).not.toMatch(/\.(insert|update|delete|upsert|truncate)\s*\(/);
    const mutationRpcNames = [...source.matchAll(/runCommand\('([^']+)'/g)].map((match) => match[1]);
    expect([...new Set(mutationRpcNames)].sort()).toEqual(['archive_category', 'create_category', 'record_categorized_financial_event']);
    expect(source.match(/client\.rpc\('get_category_command_result'/g)).toHaveLength(1);
  });
});
