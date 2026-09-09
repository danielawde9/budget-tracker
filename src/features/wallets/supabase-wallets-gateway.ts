import type { Currency } from '../loans/types.js';
import type {
  CommandResult,
  CreateWalletInput,
  JournalEvent,
  JournalEventKind,
  JournalMovement,
  JournalPage,
  RecordEventInput,
  ReverseEventInput,
  WalletProjection,
  WalletsGateway,
} from './types.js';

const WALLET_READ_LIMIT = 500;
const HISTORY_PAGE_SIZE = 20;
const RELATED_READ_LIMIT = HISTORY_PAGE_SIZE * 20;

interface DataError {
  message: string;
  code?: string;
}

interface DataResult {
  data: unknown[] | null;
  error: DataError | null;
}

export interface WalletsQueryBuilder {
  select(columns?: string): WalletsQueryBuilder;
  eq(column: string, value: unknown): WalletsQueryBuilder;
  is(column: string, value: null): WalletsQueryBuilder;
  in(column: string, values: readonly unknown[]): WalletsQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): WalletsQueryBuilder;
  limit(count: number): Promise<DataResult>;
  range(from: number, to: number): Promise<DataResult>;
}

export interface WalletsDataClient {
  from(relation: string): WalletsQueryBuilder;
  rpc(name: string, args: Record<string, unknown>): Promise<DataResult>;
}

type Row = Record<string, unknown>;
type MutationName = 'create_wallet' | 'record_financial_event' | 'reverse_financial_event';

const currencies = new Set<Currency>(['USD', 'LBP']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventKinds = new Set<JournalEventKind>([
  'opening_balance',
  'income',
  'expense',
  'transfer',
  'loan_opening',
  'loan_lend',
  'loan_borrow',
  'loan_receive_repayment',
  'loan_repay_borrowing',
  'reversal',
]);

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The database returned an invalid row.');
  }
  return value as Row;
}

function textValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') throw new Error(`The database row is missing ${key}.`);
  return result;
}

function nullableText(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== 'string') throw new Error(`The database row has invalid ${key}.`);
  return result;
}

function uuidValue(value: Row, key: string): string {
  const result = textValue(value, key);
  if (!uuidPattern.test(result)) throw new Error(`The database row has invalid ${key}.`);
  return result;
}

function currencyValue(value: Row, key: string): Currency {
  const result = textValue(value, key) as Currency;
  if (!currencies.has(result)) throw new Error(`The database row has unsupported ${key}.`);
  return result;
}

function eventKindValue(value: Row): JournalEventKind {
  const result = textValue(value, 'kind') as JournalEventKind;
  if (!eventKinds.has(result)) throw new Error('The database row has an unsupported event kind.');
  return result;
}

function minorValue(value: Row, key: string): string {
  const result = value[key];
  if (typeof result === 'string' && /^-?\d+$/.test(result)) return result;
  if (typeof result === 'number' && Number.isSafeInteger(result)) return String(result);
  throw new Error(`The database row has an unsafe ${key} money value.`);
}

async function rows(resultPromise: Promise<DataResult>, label: string, maximum: number): Promise<Row[]> {
  const result = await resultPromise;
  if (result.error) throw result.error;
  const values = result.data ?? [];
  if (values.length > maximum) throw new Error(`${label} exceeded its ${maximum}-row read bound.`);
  return values.map(asRow);
}

function commandResult(data: unknown[] | null, name: MutationName): CommandResult {
  if (data?.length !== 1) throw new Error('The wallet command must return exactly one result.');
  const id = uuidValue(asRow(data[0]), 'id');
  return name === 'create_wallet' ? { id } : { eventId: id };
}

function parseCursor(cursor: string): number {
  if (!/^\d+$/.test(cursor)) throw new Error('The journal cursor is invalid.');
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('The journal cursor is invalid.');
  return offset;
}

export function createSupabaseWalletsGateway(client: WalletsDataClient): WalletsGateway {
  async function runCommand(name: MutationName, args: Record<string, unknown>): Promise<CommandResult> {
    const result = await client.rpc(name, args);
    if (result.error) throw result.error;
    return commandResult(result.data, name);
  }

  async function loadWalletRows(spaceId: string): Promise<Row[]> {
    return rows(
      client.from('wallets').select('id,space_id,name,currency,archived_at,created_at')
        .eq('space_id', spaceId).order('created_at').limit(WALLET_READ_LIMIT + 1),
      'Wallets',
      WALLET_READ_LIMIT,
    );
  }

  function walletMap(walletRows: readonly Row[], spaceId: string): Map<string, WalletProjection> {
    return new Map(walletRows.map((value) => {
      if (textValue(value, 'space_id') !== spaceId) throw new Error('A wallet escaped the selected space.');
      const wallet: WalletProjection = {
        id: textValue(value, 'id'),
        spaceId,
        name: textValue(value, 'name'),
        currency: currencyValue(value, 'currency'),
        archivedAt: nullableText(value, 'archived_at'),
        balanceMinor: '0',
      };
      return [wallet.id, wallet];
    }));
  }

  async function composeEvents(
    spaceId: string,
    eventRows: readonly Row[],
    wallets: ReadonlyMap<string, WalletProjection>,
  ): Promise<JournalEvent[]> {
    if (eventRows.length === 0) return [];
    const eventIds = eventRows.map((value) => textValue(value, 'id'));
    const [movementRows, postingRows, reversalRows] = await Promise.all([
      rows(
        client.from('wallet_movements').select('event_id,wallet_id,amount_minor')
          .eq('space_id', spaceId).in('event_id', eventIds).limit(RELATED_READ_LIMIT + 1),
        'Wallet movements',
        RELATED_READ_LIMIT,
      ),
      rows(
        client.from('loan_postings').select('event_id').eq('space_id', spaceId)
          .in('event_id', eventIds).limit(HISTORY_PAGE_SIZE + 1),
        'Loan postings',
        HISTORY_PAGE_SIZE,
      ),
      rows(
        client.from('financial_events').select('id,reversal_of').eq('space_id', spaceId)
          .in('reversal_of', eventIds).limit(HISTORY_PAGE_SIZE + 1),
        'Event reversals',
        HISTORY_PAGE_SIZE + 1,
      ),
    ]);
    const movements = new Map<string, JournalMovement[]>();
    for (const value of movementRows) {
      const eventId = textValue(value, 'event_id');
      if (!eventIds.includes(eventId)) continue;
      const walletId = textValue(value, 'wallet_id');
      const wallet = wallets.get(walletId);
      if (!wallet) throw new Error('Journal history references an unavailable wallet.');
      const movement: JournalMovement = {
        walletId,
        walletName: wallet.name,
        currency: wallet.currency,
        amountMinor: minorValue(value, 'amount_minor'),
      };
      movements.set(eventId, [...(movements.get(eventId) ?? []), movement]);
    }
    const linkedEvents = new Set(postingRows.map((value) => textValue(value, 'event_id')));
    const reversedBy = new Map<string, string>();
    for (const value of reversalRows) {
      const original = nullableText(value, 'reversal_of');
      if (original && eventIds.includes(original)) reversedBy.set(original, textValue(value, 'id'));
    }
    return eventRows.map((value): JournalEvent => {
      if (textValue(value, 'space_id') !== spaceId) throw new Error('A journal event escaped the selected space.');
      const id = textValue(value, 'id');
      return {
        id,
        spaceId,
        requestId: textValue(value, 'request_id'),
        kind: eventKindValue(value),
        effectiveDate: textValue(value, 'effective_date'),
        createdAt: textValue(value, 'created_at'),
        reversalOf: nullableText(value, 'reversal_of'),
        reversedBy: reversedBy.get(id) ?? null,
        loanLinked: linkedEvents.has(id),
        movements: movements.get(id) ?? [],
      };
    });
  }

  async function loadPage(
    spaceId: string,
    offset: number,
    wallets: ReadonlyMap<string, WalletProjection>,
  ): Promise<JournalPage> {
    const values = await rows(
      client.from('financial_events')
        .select('id,space_id,request_id,kind,effective_date,reversal_of,created_at')
        .eq('space_id', spaceId)
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + HISTORY_PAGE_SIZE),
      'Financial events',
      HISTORY_PAGE_SIZE + 1,
    );
    const hasMore = values.length > HISTORY_PAGE_SIZE;
    const visibleRows = values.slice(0, HISTORY_PAGE_SIZE);
    return {
      events: await composeEvents(spaceId, visibleRows, wallets),
      nextCursor: hasMore ? String(offset + HISTORY_PAGE_SIZE) : null,
    };
  }

  return {
    async loadSnapshot(spaceId) {
      const [walletRows, balanceRows] = await Promise.all([
        loadWalletRows(spaceId),
        rows(
          client.from('wallet_balances').select('wallet_id,space_id,currency,amount_minor')
            .eq('space_id', spaceId).limit(WALLET_READ_LIMIT + 1),
          'Wallet balances',
          WALLET_READ_LIMIT,
        ),
      ]);
      const walletById = walletMap(walletRows, spaceId);
      for (const value of balanceRows) {
        if (textValue(value, 'space_id') !== spaceId) throw new Error('A wallet balance escaped the selected space.');
        const wallet = walletById.get(textValue(value, 'wallet_id'));
        if (!wallet || wallet.currency !== currencyValue(value, 'currency')) {
          throw new Error('A wallet balance does not match its wallet.');
        }
        walletById.set(wallet.id, { ...wallet, balanceMinor: minorValue(value, 'amount_minor') });
      }
      return {
        wallets: [...walletById.values()].filter((wallet) => wallet.archivedAt === null),
        history: await loadPage(spaceId, 0, walletById),
      };
    },

    async loadHistoryPage(spaceId, cursor) {
      const walletById = walletMap(await loadWalletRows(spaceId), spaceId);
      return loadPage(spaceId, parseCursor(cursor), walletById);
    },

    createWallet(input: CreateWalletInput) {
      return runCommand('create_wallet', {
        p_space_id: input.spaceId,
        p_name: input.name.trim(),
        p_currency: input.currency,
      });
    },

    recordEvent(input: RecordEventInput) {
      return runCommand('record_financial_event', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_kind: input.kind,
        p_effective_date: input.effectiveDate,
        p_movements: input.movements,
      });
    },

    reverseEvent(input: ReverseEventInput) {
      return runCommand('reverse_financial_event', {
        p_space_id: input.spaceId,
        p_request_id: input.requestId,
        p_event_id: input.eventId,
        p_effective_date: input.effectiveDate,
      });
    },

    async findEventByRequestId(spaceId, requestId) {
      const values = await rows(
        client.from('financial_events')
          .select('id,space_id,request_id,kind,effective_date,reversal_of,created_at')
          .eq('space_id', spaceId).eq('request_id', requestId).limit(1),
        'Financial event reconciliation',
        1,
      );
      if (!values[0]) return null;
      const walletById = walletMap(await loadWalletRows(spaceId), spaceId);
      return (await composeEvents(spaceId, values, walletById))[0] ?? null;
    },
  };
}
