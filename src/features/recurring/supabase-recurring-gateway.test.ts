import { describe, expect, it } from 'vitest';
import type { RpcBuilder, RpcResult } from '../planning-shared/rpc.js';
import { createSupabaseRecurringGateway, type RecurringDataClient } from './supabase-recurring-gateway.js';

interface RecordedCall { name: string; args: Record<string, unknown>; signal: AbortSignal | undefined }

function fakeClient(response: (call: RecordedCall) => RpcResult): { client: RecurringDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: RecurringDataClient = {
    rpc(name, args) {
      let signal: AbortSignal | undefined;
      const builder: RpcBuilder = {
        abortSignal(value) {
          signal = value;
          return builder;
        },
        then(onFulfilled, onRejected) {
          const call = { name, args, signal };
          calls.push(call);
          return Promise.resolve(response(call)).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

const SCHEDULE_ID = '00000000-0000-4000-8000-000000000301';
const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000401';
const EVENT_ID = '00000000-0000-4000-8000-000000000501';
const WALLET_ID = '00000000-0000-4000-8000-000000000601';
const CATEGORY_ID = '00000000-0000-4000-8000-000000000701';

const occurrenceFixture = {
  id: OCCURRENCE_ID, scheduleId: SCHEDULE_ID, sourceRevisionId: '1', currentEventId: null,
  currency: 'USD', kind: 'expense', nameEn: 'Rent', nameAr: null, dueDate: '2026-09-30',
  expectedMinor: '50000', settledMinor: '20000', remainingMinor: '30000', state: 'partial',
  overdue: false, categoryId: CATEGORY_ID, loanId: null, fundingGoalId: null, preferredWalletId: null,
  fundingShortfallMinor: null, asOf: '2026-09-14',
};

const occurrencePageFixture = { rows: [occurrenceFixture], hasMore: false, nextCursor: null, asOf: '2026-09-14' };

const definitionInput = {
  currency: 'USD' as const, kind: 'expense' as const, state: 'active' as const,
  nameEn: 'Rent', nameAr: null, expectedMinor: '50000', startsOn: '2026-09-01', endsOn: null,
  cadence: 'monthly' as const, intervalCount: 1, categoryId: CATEGORY_ID, loanId: null,
  fundingGoalId: null, preferredWalletId: null,
};

describe('createSupabaseRecurringGateway: loadOccurrences', () => {
  it('maps camelCase input to p_snake_case args and parses a complete valid response', async () => {
    const { client, calls } = fakeClient(() => ({ data: occurrencePageFixture, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    });
    expect(calls[0]).toMatchObject({
      name: 'scheduled_occurrence_page',
      args: { p_space_id: 'space-1', p_from_date: '2026-09-01', p_to_date: '2026-09-30', p_after_due_date: null, p_after_id: null, p_limit: 25 },
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.remainingMinor).toBe('30000');
    expect(result.rows[0]!.state).toBe('partial');
  });

  it('preserves a bigint identifier beyond Number.MAX_SAFE_INTEGER as text', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, rows: [{ ...occurrenceFixture, sourceRevisionId: '9007199254740993' }] }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    });
    expect(result.rows[0]!.sourceRevisionId).toBe('9007199254740993');
  });

  it('rejects the equivalent unsafe money number in the response', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, rows: [{ ...occurrenceFixture, expectedMinor: 9_007_199_254_740_993 }] }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    })).rejects.toThrow();
  });

  it('rejects a null required string field', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, rows: [{ ...occurrenceFixture, id: null }] }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    })).rejects.toThrow();
  });

  it('rejects an unknown state enum even though the field is typed as a string', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, rows: [{ ...occurrenceFixture, state: 'overdue' }] }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    })).rejects.toThrow();
  });

  it('rejects duplicate occurrence rows', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, rows: [occurrenceFixture, occurrenceFixture] }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    })).rejects.toThrow();
  });

  it('rejects an invalid leap date', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, rows: [{ ...occurrenceFixture, dueDate: '2025-02-29' }] }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    })).rejects.toThrow();
  });

  it('forwards the caller-supplied limit and trusts the DB bound', async () => {
    const { client, calls } = fakeClient(() => ({ data: occurrencePageFixture, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    await gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 100,
    });
    expect(calls[0]!.args['p_limit']).toBe(100);
  });

  it('rejects a partial page cursor before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: occurrencePageFixture, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: '2026-09-10', afterId: null, limit: 25,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('parses a complete two-part cursor', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, hasMore: true, nextCursor: { dueDate: '2026-09-20', id: OCCURRENCE_ID } }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    });
    expect(result.nextCursor).toEqual({ dueDate: '2026-09-20', id: OCCURRENCE_ID });
  });

  it('forwards the caller AbortSignal into the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: occurrencePageFixture, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    const controller = new AbortController();
    await gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    }, controller.signal);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('createSupabaseRecurringGateway: another space\'s stale response', () => {
  it('rejects a response whose row carries a currency the DTO does not recognize', async () => {
    const { client } = fakeClient(() => ({
      data: { ...occurrencePageFixture, rows: [{ ...occurrenceFixture, currency: 'EUR' }] }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.loadOccurrences({
      spaceId: 'space-1', fromDate: '2026-09-01', toDate: '2026-09-30', afterDueDate: null, afterId: null, limit: 25,
    })).rejects.toThrow();
  });
});

describe('createSupabaseRecurringGateway: mutations', () => {
  it('saveSchedule sends the exact definition shape and parses the result', async () => {
    const { client, calls } = fakeClient(() => ({ data: { scheduleId: SCHEDULE_ID, revisionId: '1' }, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.saveSchedule({
      spaceId: 'space-1', requestId: 'req-1', scheduleId: SCHEDULE_ID, expectedRevisionId: null, definition: definitionInput,
    });
    expect(calls[0]!.name).toBe('save_schedule');
    expect(calls[0]!.args['p_expected_revision_id']).toBeNull();
    expect(calls[0]!.args['p_definition']).toMatchObject({
      currency: 'USD', kind: 'expense', state: 'active', expectedMinor: '50000', cadence: 'monthly', intervalCount: 1,
    });
    expect(result).toEqual({ scheduleId: SCHEDULE_ID, revisionId: '1' });
  });

  it('saveSchedule converts a text expected revision id to a safe number for an edit', async () => {
    const { client, calls } = fakeClient(() => ({ data: { scheduleId: SCHEDULE_ID, revisionId: '2' }, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    await gateway.saveSchedule({
      spaceId: 'space-1', requestId: 'req-1', scheduleId: SCHEDULE_ID, expectedRevisionId: '1', definition: definitionInput,
    });
    expect(calls[0]!.args['p_expected_revision_id']).toBe(1);
  });

  it('materialize sends the exact date range and parses createdCount/existingCount', async () => {
    const { client, calls } = fakeClient(() => ({
      data: { createdCount: 3, existingCount: 1, fromDate: '2026-09-01', toDate: '2026-11-30' }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.materialize({ spaceId: 'space-1', requestId: 'req-1', fromDate: '2026-09-01', toDate: '2026-11-30' });
    expect(calls[0]).toMatchObject({
      name: 'materialize_schedule_occurrences',
      args: { p_space_id: 'space-1', p_request_id: 'req-1', p_from_date: '2026-09-01', p_to_date: '2026-11-30' },
    });
    expect(result).toEqual({ createdCount: 3, existingCount: 1, fromDate: '2026-09-01', toDate: '2026-11-30' });
  });

  it('setOccurrenceState sends a null expected event id when there is no prior event', async () => {
    const { client, calls } = fakeClient(() => ({ data: { occurrenceId: OCCURRENCE_ID, eventId: '1' }, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.setOccurrenceState({
      spaceId: 'space-1', requestId: 'req-1', occurrenceId: OCCURRENCE_ID, expectedEventId: null, action: 'skip',
    });
    expect(calls[0]).toMatchObject({
      name: 'set_occurrence_state',
      args: { p_occurrence_id: OCCURRENCE_ID, p_expected_event_id: null, p_action: 'skip' },
    });
    expect(result).toEqual({ occurrenceId: OCCURRENCE_ID, eventId: '1' });
  });

  it('setOccurrenceState converts a text expected event id to a safe number', async () => {
    const { client, calls } = fakeClient(() => ({ data: { occurrenceId: OCCURRENCE_ID, eventId: '2' }, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    await gateway.setOccurrenceState({
      spaceId: 'space-1', requestId: 'req-1', occurrenceId: OCCURRENCE_ID, expectedEventId: '1', action: 'reopen',
    });
    expect(calls[0]!.args['p_expected_event_id']).toBe(1);
  });

  it('confirm sends the actual amount, effective date and wallet exactly', async () => {
    const { client, calls } = fakeClient(() => ({
      data: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '1', financialEventId: EVENT_ID }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.confirm({
      spaceId: 'space-1', requestId: 'req-1', occurrenceId: OCCURRENCE_ID, expectedEventId: null,
      actualAmountMinor: '50000', effectiveDate: '2026-09-30', walletId: WALLET_ID,
    });
    expect(calls[0]).toMatchObject({
      name: 'confirm_scheduled_occurrence',
      args: {
        p_occurrence_id: OCCURRENCE_ID, p_expected_event_id: null, p_actual_amount_minor: '50000',
        p_effective_date: '2026-09-30', p_wallet_id: WALLET_ID,
      },
    });
    expect(result).toEqual({ occurrenceId: OCCURRENCE_ID, occurrenceEventId: '1', financialEventId: EVENT_ID });
  });

  it('confirm rejects a malformed effective date before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: {}, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.confirm({
      spaceId: 'space-1', requestId: 'req-1', occurrenceId: OCCURRENCE_ID, expectedEventId: null,
      actualAmountMinor: '50000', effectiveDate: '2026-13-01', walletId: WALLET_ID,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('linkExisting sends the linked event id, amount and expected event id exactly', async () => {
    const { client, calls } = fakeClient(() => ({
      data: { occurrenceId: OCCURRENCE_ID, occurrenceEventId: '1', financialEventId: EVENT_ID }, error: null,
    }));
    const gateway = createSupabaseRecurringGateway(client);
    const result = await gateway.linkExisting({
      spaceId: 'space-1', requestId: 'req-1', occurrenceId: OCCURRENCE_ID, eventId: EVENT_ID,
      amountMinor: '20000', expectedEventId: '1',
    });
    expect(calls[0]).toMatchObject({
      name: 'link_scheduled_payment',
      args: { p_occurrence_id: OCCURRENCE_ID, p_event_id: EVENT_ID, p_amount_minor: '20000', p_expected_event_id: 1 },
    });
    expect(result).toEqual({ occurrenceId: OCCURRENCE_ID, occurrenceEventId: '1', financialEventId: EVENT_ID });
  });

  it('rejects a non-canonical (floating-point-shaped) money string before calling the transport', async () => {
    const { client, calls } = fakeClient(() => ({ data: {}, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.confirm({
      spaceId: 'space-1', requestId: 'req-1', occurrenceId: OCCURRENCE_ID, expectedEventId: null,
      actualAmountMinor: '500.00', effectiveDate: '2026-09-30', walletId: WALLET_ID,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('findCommand returns null for an absent receipt', async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    const receipt = await gateway.findCommand('space-1', 'req-1');
    expect(receipt).toBeNull();
  });

  it('findCommand parses a present receipt', async () => {
    const { client } = fakeClient(() => ({ data: { command: 'confirm_scheduled_occurrence', sequenceId: '1', result: { occurrenceId: OCCURRENCE_ID } }, error: null }));
    const gateway = createSupabaseRecurringGateway(client);
    const receipt = await gateway.findCommand('space-1', 'req-1');
    expect(receipt).toEqual({ command: 'confirm_scheduled_occurrence', sequenceId: '1', result: { occurrenceId: OCCURRENCE_ID } });
  });

  it('surfaces a transport error instead of swallowing it', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: '40001', message: 'planning_stale_revision' } }));
    const gateway = createSupabaseRecurringGateway(client);
    await expect(gateway.saveSchedule({
      spaceId: 'space-1', requestId: 'req-1', scheduleId: SCHEDULE_ID, expectedRevisionId: null, definition: definitionInput,
    })).rejects.toMatchObject({ code: '40001' });
  });
});
