import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createSupabaseWalletsGateway,
  type WalletsDataClient,
  type WalletsQueryBuilder,
} from './supabase-wallets-gateway.js';

type Result = { data: unknown[] | null; error: { message: string } | null };
type Operation = { relation: string; name: string; args: readonly unknown[] };

const walletCommandId = '11111111-1111-4111-8111-111111111111';
const eventCommandId = '22222222-2222-4222-8222-222222222222';

class RecordingBuilder implements WalletsQueryBuilder {
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
  order(column: string, options?: { ascending?: boolean }) { return this.record('order', column, options); }
  limit(count: number) { this.record('limit', count); return Promise.resolve(this.result); }
  range(from: number, to: number) { this.record('range', from, to); return Promise.resolve(this.result); }
}

function clientWith(
  overrides: Partial<Record<string, unknown[]>> = {},
  rpcOverrides: Partial<Record<string, readonly unknown[] | null>> = {},
) {
  const operations: Operation[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const values: Record<string, unknown[]> = {
    wallets: [{ id: 'wallet-1', space_id: 'space-1', name: 'Daily', currency: 'USD', archived_at: null }],
    wallet_balances: [{ wallet_id: 'wallet-1', space_id: 'space-1', currency: 'USD', amount_minor: '1250' }],
    financial_events: [{ id: 'event-1', space_id: 'space-1', request_id: 'request-1', kind: 'income', effective_date: '2026-09-08', reversal_of: null, created_at: '2026-09-08T10:00:00Z' }],
    wallet_movements: [{ event_id: 'event-1', wallet_id: 'wallet-1', amount_minor: '1250' }],
    loan_postings: [],
    ...overrides,
  };
  const client: WalletsDataClient = {
    from(relation) {
      return new RecordingBuilder(relation, { data: values[relation] ?? [], error: null }, operations);
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (Object.hasOwn(rpcOverrides, name)) {
        const data = rpcOverrides[name];
        return { data: data === null ? null : [...(data ?? [])], error: null };
      }
      return { data: [{ id: name === 'create_wallet' ? walletCommandId : eventCommandId }], error: null };
    },
  };
  return { client, operations, rpcCalls };
}

describe('Supabase Wallets gateway', () => {
  it('loads active wallet projections and one bounded journal page from RLS relations', async () => {
    const { client, operations } = clientWith();
    const snapshot = await createSupabaseWalletsGateway(client).loadSnapshot('space-1');

    expect(snapshot.wallets).toEqual([{ id: 'wallet-1', spaceId: 'space-1', name: 'Daily', currency: 'USD', archivedAt: null, balanceMinor: '1250' }]);
    expect(snapshot.history.events[0]).toMatchObject({ id: 'event-1', requestId: 'request-1', loanLinked: false });
    expect(snapshot.history.events[0]?.movements).toEqual([{ walletId: 'wallet-1', walletName: 'Daily', currency: 'USD', amountMinor: '1250' }]);
    expect(operations).toContainEqual({ relation: 'wallets', name: 'eq', args: ['space_id', 'space-1'] });
    expect(operations).toContainEqual({ relation: 'financial_events', name: 'range', args: [0, 20] });
    expect(operations).toContainEqual({ relation: 'wallet_movements', name: 'in', args: ['event_id', ['event-1']] });
  });

  it.each([
    ['an exact integer string', '9007199254740993', '9007199254740993'],
    ['a safe integer number', 1250, '1250'],
  ])('normalizes %s at the bigint projection boundary', async (_label, amountMinor, expected) => {
    const { client } = clientWith({
      wallet_balances: [{ wallet_id: 'wallet-1', space_id: 'space-1', currency: 'USD', amount_minor: amountMinor }],
    });

    await expect(createSupabaseWalletsGateway(client).loadSnapshot('space-1'))
      .resolves.toMatchObject({ wallets: [{ balanceMinor: expected }] });
  });

  it('returns an opaque next cursor and marks loan-linked and reversed events', async () => {
    const events = Array.from({ length: 21 }, (_, index) => ({
      id: `event-${index}`,
      space_id: 'space-1',
      request_id: `request-${index}`,
      kind: index === 0 ? 'loan_lend' : 'income',
      effective_date: '2026-09-08',
      reversal_of: index === 1 ? 'event-2' : null,
      created_at: `2026-09-08T10:${String(index).padStart(2, '0')}:00Z`,
    }));
    const { client } = clientWith({
      financial_events: events,
      wallet_movements: [],
      loan_postings: [{ event_id: 'event-0' }],
    });

    const page = (await createSupabaseWalletsGateway(client).loadSnapshot('space-1')).history;
    expect(page.events).toHaveLength(20);
    expect(page.nextCursor).toBe('20');
    expect(page.events.find((event) => event.id === 'event-0')?.loanLinked).toBe(true);
    expect(page.events.find((event) => event.id === 'event-2')?.reversedBy).toBe('event-1');
  });

  it('sends exact approved RPC payloads', async () => {
    const { client, rpcCalls } = clientWith();
    const gateway = createSupabaseWalletsGateway(client);
    await gateway.createWallet({ spaceId: 'space-1', name: '  Reserve  ', currency: 'LBP' });
    await gateway.recordEvent({ spaceId: 'space-1', requestId: 'request-1', kind: 'transfer', effectiveDate: '2026-09-08', movements: [{ walletId: 'wallet-1', amountMinor: '-500' }, { walletId: 'wallet-2', amountMinor: '500' }] });
    await gateway.reverseEvent({ spaceId: 'space-1', requestId: 'request-2', eventId: 'event-1', effectiveDate: '2026-09-09' });

    expect(rpcCalls).toEqual([
      { name: 'create_wallet', args: { p_space_id: 'space-1', p_name: 'Reserve', p_currency: 'LBP' } },
      { name: 'record_financial_event', args: { p_space_id: 'space-1', p_request_id: 'request-1', p_kind: 'transfer', p_effective_date: '2026-09-08', p_movements: [{ walletId: 'wallet-1', amountMinor: '-500' }, { walletId: 'wallet-2', amountMinor: '500' }] } },
      { name: 'reverse_financial_event', args: { p_space_id: 'space-1', p_request_id: 'request-2', p_event_id: 'event-1', p_effective_date: '2026-09-09' } },
    ]);
  });

  it('returns only each wallet command\'s required normalized UUID field', async () => {
    const { client } = clientWith();
    const gateway = createSupabaseWalletsGateway(client);

    await expect(gateway.createWallet({ spaceId: 'space-1', name: 'Reserve', currency: 'USD' }))
      .resolves.toEqual({ id: walletCommandId });
    await expect(gateway.recordEvent({
      spaceId: 'space-1', requestId: 'request-1', kind: 'income', effectiveDate: '2026-09-08',
      movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
    })).resolves.toEqual({ eventId: eventCommandId });
    await expect(gateway.reverseEvent({
      spaceId: 'space-1', requestId: 'request-2', eventId: 'event-1', effectiveDate: '2026-09-09',
    })).resolves.toEqual({ eventId: eventCommandId });
  });

  it.each([
    ['null data', null, /exactly one result/],
    ['zero rows', [], /exactly one result/],
    ['multiple rows', [{ id: eventCommandId }, { id: eventCommandId }], /exactly one result/],
    ['a null row', [null], /invalid row/],
    ['a missing identifier', [{}], /missing id/],
    ['a null identifier', [{ id: null }], /missing id/],
    ['a malformed identifier', [{ id: 'event-new' }], /invalid id/],
  ] as const)('rejects %s for every wallet command before success handling', async (_label, response, message) => {
    const commands = [
      {
        rpc: 'create_wallet',
        invoke: (gateway: ReturnType<typeof createSupabaseWalletsGateway>) => gateway.createWallet({
          spaceId: 'space-1', name: 'Reserve', currency: 'USD',
        }),
      },
      {
        rpc: 'record_financial_event',
        invoke: (gateway: ReturnType<typeof createSupabaseWalletsGateway>) => gateway.recordEvent({
          spaceId: 'space-1', requestId: 'request-1', kind: 'income', effectiveDate: '2026-09-08',
          movements: [{ walletId: 'wallet-1', amountMinor: '500' }],
        }),
      },
      {
        rpc: 'reverse_financial_event',
        invoke: (gateway: ReturnType<typeof createSupabaseWalletsGateway>) => gateway.reverseEvent({
          spaceId: 'space-1', requestId: 'request-2', eventId: 'event-1', effectiveDate: '2026-09-09',
        }),
      },
    ] as const;

    for (const command of commands) {
      const { client } = clientWith({}, { [command.rpc]: response });
      await expect(command.invoke(createSupabaseWalletsGateway(client))).rejects.toThrow(message);
    }
  });

  it('reconciles an event using both space and request ID with a one-row bound', async () => {
    const { client, operations } = clientWith();
    const event = await createSupabaseWalletsGateway(client).findEventByRequestId('space-1', 'request-1');
    expect(event?.id).toBe('event-1');
    expect(operations).toContainEqual({ relation: 'financial_events', name: 'eq', args: ['space_id', 'space-1'] });
    expect(operations).toContainEqual({ relation: 'financial_events', name: 'eq', args: ['request_id', 'request-1'] });
    expect(operations).toContainEqual({ relation: 'financial_events', name: 'limit', args: [1] });
  });

  it('ratchets browser writes and mutation RPCs to the approved boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/wallets/supabase-wallets-gateway.ts'), 'utf8');
    expect(source).not.toMatch(/\.(insert|update|delete|upsert|truncate)\s*\(/);
    const rpcNames = [...source.matchAll(/runCommand\('([^']+)'/g)].map((match) => match[1]);
    expect([...new Set(rpcNames)].sort()).toEqual(['create_wallet', 'record_financial_event', 'reverse_financial_event']);
  });
});
