import type { LoansDataClient } from '../loans/supabase-loans-gateway.js';
import type { Currency, Space, Wallet } from '../loans/types.js';
import type { CreatedRecord, WorkspaceGateway } from './types.js';

const READ_LIMIT = 500;
type Row = Record<string, unknown>;

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The database returned an invalid workspace row.');
  }
  return value as Row;
}

function text(value: Row, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') throw new Error(`The workspace row is missing ${key}.`);
  return result;
}

function nullableText(value: Row, key: string): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== 'string') throw new Error(`The workspace row has invalid ${key}.`);
  return result;
}

async function readRows(resultPromise: ReturnType<ReturnType<LoansDataClient['from']>['limit']>, label: string): Promise<Row[]> {
  const result = await resultPromise;
  if (result.error) throw result.error;
  const values = result.data ?? [];
  if (values.length > READ_LIMIT) throw new Error(`${label} has more than ${READ_LIMIT} rows. Narrow the workspace before continuing.`);
  return values.map(row);
}

function commandRecord(values: unknown[] | null): CreatedRecord {
  const value = row(values?.[0]);
  return { id: text(value, 'id') };
}

export function createSupabaseWorkspaceGateway(client: LoansDataClient): WorkspaceGateway {
  async function runCommand(name: 'create_space' | 'create_wallet', args: Record<string, unknown>): Promise<CreatedRecord> {
    const result = await client.rpc(name, args);
    if (result.error) throw result.error;
    return commandRecord(result.data);
  }

  return {
    async listSpaces() {
      const values = await readRows(client.from('spaces').select('id,name,kind').order('created_at').limit(READ_LIMIT + 1), 'Spaces');
      return values.map((value): Space => ({ id: text(value, 'id'), name: text(value, 'name'), kind: text(value, 'kind') as Space['kind'] }));
    },

    async listWallets(spaceId) {
      const values = await readRows(client.from('wallets').select('id,space_id,name,currency,archived_at').eq('space_id', spaceId).is('archived_at', null).order('created_at').limit(READ_LIMIT + 1), 'Wallets');
      return values.map((value): Wallet => ({
        id: text(value, 'id'),
        spaceId: text(value, 'space_id'),
        name: text(value, 'name'),
        currency: text(value, 'currency') as Currency,
        archivedAt: nullableText(value, 'archived_at'),
      }));
    },

    createSpace(input) {
      return runCommand('create_space', { p_name: input.name, p_kind: input.kind });
    },

    createWallet(input) {
      return runCommand('create_wallet', { p_space_id: input.spaceId, p_name: input.name, p_currency: input.currency });
    },
  };
}
