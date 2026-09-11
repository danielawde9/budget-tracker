import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapCompatibilityObjects,
  createDisposableDatabase,
  disposeDisposableDatabase,
  expectSavepointRejection,
  migrationFiles,
  orderedAuthenticatedRace,
  replayMigrations,
  withAuthenticatedTransaction,
  withRollback,
  type DisposableDatabase,
  type MigrationFile,
} from './disposable-database.js';

type Currency = 'USD' | 'LBP';
type GeneralEventKind = 'opening_balance' | 'income' | 'expense' | 'transfer';

interface MovementInput {
  walletId: string;
  amountMinor: string;
}

interface WalletRow {
  id: string;
  space_id: string;
  name: string;
  currency: Currency;
  archived_at: Date | null;
  created_at: Date;
}

interface LogRow {
  request_id: string;
  command_kind: string;
  wallet_id: string;
  actor_id: string;
  previous_name: string | null;
  name: string | null;
}

const lifecycleVersion = '20260911100000';
const ownerWriteError = { code: '42501', message: 'protected rows may be written only by their owning command' };
const walletShapeError = { code: '42501', message: 'wallets may change only their name and archive state' };
const walletDeleteError = { code: '42501', message: 'wallets are archived, never deleted' };
const logImmutableError = { code: '42501', message: 'wallet command history is immutable' };
const genericPostingError = {
  code: 'P0001',
  message: 'every movement must contain a unique active wallet and a bounded nonzero minor-unit amount',
};
const loanWalletError = {
  code: 'P0001',
  message: 'the wallet must be active, in the requested space, and in the loan currency',
};
const inactiveMovementError = { code: 'P0001', message: 'every wallet movement must use an active wallet' };
const membershipError = { code: '42501', message: 'an active space membership is required' };
const replayError = { code: 'P0001', message: 'request ID was already used with different data' };
const missingIdsError = { code: 'P0001', message: 'request ID and wallet ID are required' };
const foreignWalletError = { code: 'P0001', message: 'the wallet does not belong to the requested space' };
const archivedWalletError = { code: 'P0001', message: 'the wallet is archived' };
const nameLengthError = { code: 'P0001', message: 'the wallet name must be 1 to 120 characters' };
const sameNameError = { code: 'P0001', message: 'the wallet already has this name' };
const alreadyArchivedError = { code: 'P0001', message: 'the wallet is already archived' };
const nonZeroBalanceError = { code: 'P0001', message: 'the wallet balance must be zero to archive' };
const notArchivedError = { code: 'P0001', message: 'the wallet is not archived' };

interface WalletCommand {
  spaceId: string | null;
  requestId: string | null;
  walletId: string | null;
}

interface RenameCommand extends WalletCommand {
  name: string | null;
}

async function insertUsers(client: Client, userIds: readonly string[]): Promise<void> {
  if (userIds.length < 1 || userIds.length > 8) {
    throw new Error('test user setup accepts between one and eight users');
  }
  await client.query(
    `insert into auth.users (id, email, email_confirmed_at)
     select user_id, 'wallets-' || user_id::text || '@budget.invalid', now()
     from unnest($1::uuid[]) as user_id
     limit 8`,
    [userIds],
  );
}

async function createSpace(client: Client, ownerId: string, kind: 'personal' | 'household'): Promise<string> {
  return withAuthenticatedTransaction(client, ownerId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.create_space($1, $2) limit 2',
      [`Wallets ${randomUUID()}`, kind],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function addHouseholdMember(client: Client, spaceId: string, userId: string): Promise<void> {
  await client.query(
    "insert into public.space_memberships (space_id, user_id, role) values ($1, $2, 'member')",
    [spaceId, userId],
  );
}

async function createWallet(
  client: Client,
  actorId: string,
  spaceId: string,
  name: string,
  currency: Currency = 'USD',
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.create_wallet($1, $2, $3::public.currency_code) limit 2',
      [spaceId, name, currency],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function postEvent(
  client: Client,
  actorId: string,
  spaceId: string,
  kind: GeneralEventKind,
  movements: readonly MovementInput[],
  requestId: string = randomUUID(),
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.record_financial_event(
         $1, $2, $3::public.financial_event_kind, '2026-09-11', $4::jsonb
       ) limit 2`,
      [spaceId, requestId, kind, JSON.stringify(movements)],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function walletRow(client: Client, walletId: string): Promise<WalletRow> {
  const result = await client.query<WalletRow>(
    `select id, space_id, name, currency::text as currency, archived_at, created_at
     from public.wallets
     where id = $1
     limit 2`,
    [walletId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function walletBalance(client: Client, walletId: string): Promise<string> {
  const result = await client.query<{ amount_minor: string }>(
    `select coalesce(sum(amount_minor), 0)::text as amount_minor
     from public.wallet_movements
     where wallet_id = $1
     limit 1`,
    [walletId],
  );
  return result.rows[0]?.amount_minor ?? '0';
}

async function archiveWalletDirectly(client: Client, walletId: string): Promise<void> {
  const result = await client.query(
    'update public.wallets set archived_at = now() where id = $1 and archived_at is null',
    [walletId],
  );
  expect(result.rowCount).toBe(1);
}

async function logRows(client: Client, walletId: string): Promise<LogRow[]> {
  const result = await client.query<LogRow>(
    `select request_id, command_kind, wallet_id, actor_id, previous_name, name
     from public.wallet_command_requests
     where wallet_id = $1
     order by created_at, request_id
     limit 51`,
    [walletId],
  );
  expect(result.rows.length).toBeLessThanOrEqual(50);
  return result.rows;
}

async function functionCatalog(client: Client, signatures: readonly string[]) {
  const result = await client.query<Record<string, unknown>>(
    `select procedure.oid::regprocedure::text as signature,
       pg_get_function_result(procedure.oid) as result,
       procedure.prosecdef, procedure.provolatile, procedure.proconfig,
       has_function_privilege('public', procedure.oid, 'execute') as public_exec,
       has_function_privilege('anon', procedure.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', procedure.oid, 'execute') as service_exec
     from pg_proc as procedure
     where procedure.oid = any($1::regprocedure[])
     order by procedure.oid::regprocedure::text collate "C"
     limit 20`,
    [signatures],
  );
  expect(result.rows).toHaveLength(signatures.length);
  return result.rows;
}

async function reverseEvent(client: Client, actorId: string, spaceId: string, eventId: string): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      "select * from public.reverse_financial_event($1, $2, $3, '2026-09-11') limit 2",
      [spaceId, randomUUID(), eventId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function createExpenseCategory(client: Client, actorId: string, spaceId: string): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      "select * from public.create_category($1, $2, 'expense', $3, null) limit 2",
      [spaceId, randomUUID(), `Groceries ${randomUUID()}`],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function postCategorizedExpense(
  client: Client,
  actorId: string,
  spaceId: string,
  walletId: string,
  categoryId: string,
  amountMinor: string,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.record_categorized_financial_event(
         $1, $2, 'expense', '2026-09-11', $3::jsonb, $4
       ) limit 2`,
      [spaceId, randomUUID(), JSON.stringify([{ walletId, amountMinor }]), categoryId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function recordCashLoan(
  client: Client,
  actorId: string,
  spaceId: string,
  walletId: string,
  amountMinor: string,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ loan_id: string }>(
      `select loan_id from public.record_cash_loan(
         $1, $2, 'they_owe_me', 'Sami', 'USD', $3, $4, '2026-09-11', null, null
       ) limit 2`,
      [spaceId, randomUUID(), walletId, amountMinor],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.loan_id;
  });
}

async function repayLoan(
  client: Client,
  actorId: string,
  spaceId: string,
  loanId: string,
  walletId: string,
  amountMinor: string,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ event_id: string }>(
      "select event_id from public.record_loan_repayment($1, $2, $3, $4, $5, '2026-09-11') limit 2",
      [spaceId, randomUUID(), loanId, walletId, amountMinor],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.event_id;
  });
}

async function renameWallet(client: Client, actorId: string, command: RenameCommand): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      'select * from public.rename_wallet($1, $2, $3, $4) limit 2',
      [command.spaceId, command.requestId, command.walletId, command.name],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function commandResult(
  client: Client,
  actorId: string,
  spaceId: string,
  requestId: string,
): Promise<Array<{ command_kind: string; wallet_id: string }>> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ command_kind: string; wallet_id: string }>(
      'select command_kind, wallet_id from public.get_wallet_command_result($1, $2) limit 2',
      [spaceId, requestId],
    );
    return result.rows;
  });
}

async function walletLifecycleCommand(
  client: Client,
  actorId: string,
  command: 'archive_wallet' | 'restore_wallet',
  input: WalletCommand,
): Promise<string> {
  return withAuthenticatedTransaction(client, actorId, async () => {
    const result = await client.query<{ id: string }>(
      `select * from public.${command}($1, $2, $3) limit 2`,
      [input.spaceId, input.requestId, input.walletId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}

async function postIncomeInOpenTransaction(client: Client, spaceId: string, walletId: string, requestId: string) {
  return client.query(
    "select * from public.record_financial_event($1, $2, 'income', '2026-09-11', $3::jsonb) limit 2",
    [spaceId, requestId, JSON.stringify([{ walletId, amountMinor: '500' }])],
  );
}

async function archiveInOpenTransaction(client: Client, spaceId: string, walletId: string) {
  return client.query('select * from public.archive_wallet($1, $2, $3) limit 2', [spaceId, randomUUID(), walletId]);
}

describe('wallet lifecycle database contract', () => {
  let database: DisposableDatabase | undefined;
  let migrations: MigrationFile[] = [];
  let ownerId = '';
  let memberId = '';
  let outsiderId = '';
  let personalId = '';
  let householdId = '';

  function currentDatabase(): DisposableDatabase {
    if (!database) {
      throw new Error('disposable database is unavailable');
    }
    return database;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase('budget_wallets');
    try {
      await bootstrapCompatibilityObjects(database.client);
      migrations = migrationFiles();
      await replayMigrations(database.client, migrations);
      ownerId = randomUUID();
      memberId = randomUUID();
      outsiderId = randomUUID();
      await insertUsers(database.client, [ownerId, memberId, outsiderId]);
      personalId = await createSpace(database.client, ownerId, 'personal');
      householdId = await createSpace(database.client, ownerId, 'household');
      await addHouseholdMember(database.client, householdId, memberId);
    } catch (error) {
      const failedDatabase = database;
      database = undefined;
      try {
        await disposeDisposableDatabase(failedDatabase);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'setup and cleanup both failed');
      }
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    if (!database) {
      return;
    }
    const completedDatabase = database;
    database = undefined;
    await disposeDisposableDatabase(completedDatabase);
  }, 60_000);

  it('replays the complete journal including the wallet lifecycle migration', async () => {
    const { client } = currentDatabase();
    const journal = await client.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations order by version limit 101',
    );
    expect(journal.rows.map(({ version }) => version)).toEqual(migrations.map(({ version }) => version));
    expect(migrations.map(({ version }) => version)).toContain(lifecycleVersion);
  });

  it('keeps the wallet command log behind row security with no raw client access', async () => {
    const { client } = currentDatabase();
    const table = await client.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.wallet_command_requests'::regclass limit 2",
    );
    expect(table.rows).toEqual([{ relrowsecurity: true }]);
    const policies = await client.query(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'wallet_command_requests'
       limit 2`,
    );
    expect(policies.rows).toEqual([]);
    const grants = await client.query<Record<string, unknown>>(
      `select role_name,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'select') as select,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'insert') as insert,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'update') as update,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'delete') as delete,
         has_table_privilege(role_name, 'public.wallet_command_requests', 'truncate') as truncate
       from unnest(array['public', 'anon', 'authenticated', 'service_role']) as role_name
       order by role_name collate "C"
       limit 5`,
    );
    expect(grants.rows).toEqual(['anon', 'authenticated', 'public', 'service_role'].map((role_name) => ({
      role_name, select: false, insert: false, update: false, delete: false, truncate: false,
    })));
    const constraints = await client.query<{ conname: string; contype: string }>(
      `select conname, contype from pg_constraint
       where conrelid = 'public.wallet_command_requests'::regclass
         and contype in ('c', 'f', 'p', 'u')
       order by conname
       limit 10`,
    );
    expect(constraints.rows).toEqual([
      { conname: 'wallet_command_requests_actor_id_fkey', contype: 'f' },
      { conname: 'wallet_command_requests_kind_check', contype: 'c' },
      { conname: 'wallet_command_requests_names_check', contype: 'c' },
      { conname: 'wallet_command_requests_pkey', contype: 'p' },
      { conname: 'wallet_command_requests_space_id_fkey', contype: 'f' },
      { conname: 'wallet_command_requests_wallet_fkey', contype: 'f' },
    ]);
    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'wallet_command_requests'
       order by indexname collate "C"
       limit 5`,
    );
    expect(indexes.rows).toEqual([
      {
        indexname: 'wallet_command_requests_pkey',
        indexdef: 'CREATE UNIQUE INDEX wallet_command_requests_pkey ON public.wallet_command_requests USING btree (space_id, request_id)',
      },
      {
        indexname: 'wallet_command_requests_wallet_idx',
        indexdef: 'CREATE INDEX wallet_command_requests_wallet_idx ON public.wallet_command_requests USING btree (space_id, wallet_id)',
      },
    ]);
  });

  it('enforces command kinds, rename names, and same-space wallets in the command log', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Log ${randomUUID()}`);
    const householdWalletId = await createWallet(client, ownerId, householdId, `Log ${randomUUID()}`);
    const insert = (kind: string, targetWalletId: string, previousName: string | null, name: string | null) =>
      client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id, previous_name, name
         ) values ($1, $2, $3, pg_catalog.decode('00', 'hex'), $4, $5, $6, $7)`,
        [personalId, randomUUID(), kind, targetWalletId, ownerId, previousName, name],
      );
    const kindError = { code: '23514', constraint: 'wallet_command_requests_kind_check' };
    const namesError = { code: '23514', constraint: 'wallet_command_requests_names_check' };
    await withRollback(client, async () => {
      await expectSavepointRejection(client, () => insert('delete_wallet', walletId, null, null), kindError);
      await expectSavepointRejection(client, () => insert('rename_wallet', walletId, null, null), namesError);
      await expectSavepointRejection(client, () => insert('rename_wallet', walletId, 'Old', '   '), namesError);
      await expectSavepointRejection(client, () => insert('rename_wallet', walletId, 'Old', ' Cash '), namesError);
      await expectSavepointRejection(
        client, () => insert('rename_wallet', walletId, 'Old', 'x'.repeat(121)), namesError,
      );
      await expectSavepointRejection(client, () => insert('archive_wallet', walletId, 'Old', 'New'), namesError);
      await expectSavepointRejection(client, () => insert('archive_wallet', householdWalletId, null, null), {
        code: '23503', constraint: 'wallet_command_requests_wallet_fkey',
      });
      await insert('rename_wallet', walletId, 'Old', 'x'.repeat(120));
      await insert('restore_wallet', walletId, null, null);
    });
    expect(await logRows(client, walletId)).toEqual([]);
  });

  it('rejects command log updates, deletes including zero-row deletes, and truncation', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Immutable ${randomUUID()}`);
    await withRollback(client, async () => {
      const requestId = randomUUID();
      await client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
         ) values ($1, $2, 'archive_wallet', pg_catalog.decode('00', 'hex'), $3, $4)`,
        [personalId, requestId, walletId, ownerId],
      );
      await expectSavepointRejection(client, () => client.query(
        "update public.wallet_command_requests set command_kind = 'restore_wallet' where request_id = $1",
        [requestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where request_id = $1', [requestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where false',
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'truncate public.wallet_command_requests',
      ), logImmutableError);
    });
  });

  it('keeps log and wallet guards effective after raw grants and matching policies', async () => {
    const { client } = currentDatabase();
    const name = `Granted ${randomUUID()}`;
    const walletId = await createWallet(client, ownerId, personalId, name);
    await withRollback(client, async () => {
      const existingRequestId = randomUUID();
      await client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
         ) values ($1, $2, 'archive_wallet', pg_catalog.decode('00', 'hex'), $3, $4)`,
        [personalId, existingRequestId, walletId, ownerId],
      );
      await client.query('grant select, insert, update, delete, truncate on public.wallet_command_requests to authenticated');
      await client.query(`create policy wallet_command_requests_test_all on public.wallet_command_requests
        for all to authenticated using (true) with check (true)`);
      await client.query('grant update on public.wallets to authenticated');
      await client.query(`create policy wallets_test_update on public.wallets
        for update to authenticated using (true) with check (true)`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query('set local role authenticated');
      await expectSavepointRejection(client, () => client.query(
        `insert into public.wallet_command_requests (
           space_id, request_id, command_kind, request_fingerprint, wallet_id, actor_id
         ) values ($1, $2, 'archive_wallet', pg_catalog.decode('00', 'hex'), $3, $4)`,
        [personalId, randomUUID(), walletId, ownerId],
      ), ownerWriteError);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallet_command_requests set command_kind = 'restore_wallet' where request_id = $1",
        [existingRequestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where request_id = $1', [existingRequestId],
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallet_command_requests where false',
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        'truncate public.wallet_command_requests',
      ), logImmutableError);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set name = 'Raw rename' where id = $1", [walletId],
      ), ownerWriteError);
      await expectSavepointRejection(client, () => client.query(
        'update public.wallets set archived_at = now() where id = $1', [walletId],
      ), ownerWriteError);
    });
    expect(await walletRow(client, walletId)).toMatchObject({ name, archived_at: null });
  });

  it('lets the owning role change only a wallet name and its archive state', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Shape ${randomUUID()}`);
    const before = await walletRow(client, walletId);
    await withRollback(client, async () => {
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set currency = 'LBP' where id = $1", [walletId],
      ), walletShapeError);
      await expectSavepointRejection(client, () => client.query(
        'update public.wallets set space_id = $1 where id = $2', [householdId, walletId],
      ), walletShapeError);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set created_at = created_at - interval '1 day' where id = $1", [walletId],
      ), walletShapeError);
      await expectSavepointRejection(client, () => client.query(
        'update public.wallets set id = $1 where id = $2', [randomUUID(), walletId],
      ), walletShapeError);
      await client.query("update public.wallets set name = 'Renamed by owner' where id = $1", [walletId]);
      await client.query('update public.wallets set archived_at = now() where id = $1', [walletId]);
      await expectSavepointRejection(client, () => client.query(
        "update public.wallets set archived_at = archived_at + interval '1 second' where id = $1", [walletId],
      ), walletShapeError);
      await client.query('update public.wallets set archived_at = null where id = $1', [walletId]);
    });
    expect(await walletRow(client, walletId)).toEqual(before);
  });

  it('refuses wallet deletion by row and by zero-row statement', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Delete ${randomUUID()}`);
    await withRollback(client, async () => {
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallets where id = $1', [walletId],
      ), walletDeleteError);
      await expectSavepointRejection(client, () => client.query(
        'delete from public.wallets where false',
      ), walletDeleteError);
    });
    expect((await walletRow(client, walletId)).id).toBe(walletId);
  });

  it('pins the wallet and command log guard triggers and their private functions', async () => {
    const { client } = currentDatabase();
    const triggers = await client.query<{ tgname: string; tgenabled: string; definition: string }>(
      `select tgname, tgenabled, pg_get_triggerdef(oid) as definition
       from pg_trigger
       where tgrelid = any(array['public.wallets'::regclass, 'public.wallet_command_requests'::regclass])
         and not tgisinternal
       order by tgname collate "C"
       limit 10`,
    );
    expect(triggers.rows).toEqual([
      {
        tgname: 'wallet_command_requests_reject_row_mutation', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallet_command_requests_reject_row_mutation BEFORE DELETE OR UPDATE ON public.wallet_command_requests FOR EACH ROW EXECUTE FUNCTION private.reject_wallet_command_history_mutation()',
      },
      {
        tgname: 'wallet_command_requests_reject_statement_mutation', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallet_command_requests_reject_statement_mutation BEFORE DELETE OR TRUNCATE ON public.wallet_command_requests FOR EACH STATEMENT EXECUTE FUNCTION private.reject_wallet_command_history_mutation()',
      },
      {
        tgname: 'wallet_command_requests_require_owner_insert', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallet_command_requests_require_owner_insert BEFORE INSERT ON public.wallet_command_requests FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write()',
      },
      {
        tgname: 'wallets_guard_update', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallets_guard_update BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION private.guard_wallet_update()',
      },
      {
        tgname: 'wallets_reject_delete', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallets_reject_delete BEFORE DELETE ON public.wallets FOR EACH ROW EXECUTE FUNCTION private.reject_wallet_deletion()',
      },
      {
        tgname: 'wallets_reject_delete_statement', tgenabled: 'O',
        definition: 'CREATE TRIGGER wallets_reject_delete_statement BEFORE DELETE OR TRUNCATE ON public.wallets FOR EACH STATEMENT EXECUTE FUNCTION private.reject_wallet_deletion()',
      },
    ]);
    const privateGuard = {
      result: 'trigger', prosecdef: false, provolatile: 'v', proconfig: ['search_path=pg_catalog'],
      public_exec: false, anon_exec: false, authenticated_exec: false, service_exec: false,
    };
    expect(await functionCatalog(client, [
      'private.guard_wallet_update()',
      'private.reject_wallet_command_history_mutation()',
      'private.reject_wallet_deletion()',
    ])).toEqual([
      { signature: 'private.guard_wallet_update()', ...privateGuard },
      { signature: 'private.reject_wallet_command_history_mutation()', ...privateGuard },
      { signature: 'private.reject_wallet_deletion()', ...privateGuard },
    ]);
  });

  it('refuses a reversal that would move money through an archived wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Reversal USD');
    const incomeId = await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '500' }]);
    await postEvent(client, ownerId, personalId, 'expense', [{ walletId, amountMinor: '-500' }]);
    await archiveWalletDirectly(client, walletId);

    await expect(reverseEvent(client, ownerId, personalId, incomeId)).rejects.toMatchObject(inactiveMovementError);
    expect(await walletBalance(client, walletId)).toBe('0');
    const reversals = await client.query(
      'select id from public.financial_events where reversal_of = $1 limit 2', [incomeId],
    );
    expect(reversals.rows).toEqual([]);
  });

  it('refuses a raw owner movement into an archived wallet when command checks are bypassed', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Raw movement USD');
    await archiveWalletDirectly(client, walletId);
    await withRollback(client, async () => {
      const event = await client.query<{ id: string }>(
        `insert into public.financial_events (
           space_id, request_id, request_fingerprint, kind, effective_date, actor_id
         ) values ($1, $2, pg_catalog.decode('00', 'hex'), 'income', '2026-09-11', $3)
         returning id`,
        [personalId, randomUUID(), ownerId],
      );
      expect(event.rows).toHaveLength(1);
      await expectSavepointRejection(client, () => client.query(
        `insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor)
         values ($1, $2, $3, 500)`,
        [event.rows[0]!.id, personalId, walletId],
      ), inactiveMovementError);
    });
    expect(await walletBalance(client, walletId)).toBe('0');
  });

  // Characterization: these command-level refusals already existed. They stay
  // pinned so the trigger is proven to back up, not replace, the command checks.
  it('refuses every posting command into an archived wallet', async () => {
    const { client } = currentDatabase();
    const activeId = await createWallet(client, ownerId, personalId, 'Active lender USD');
    const archivedId = await createWallet(client, ownerId, personalId, 'Archived USD');
    await postEvent(client, ownerId, personalId, 'opening_balance', [{ walletId: activeId, amountMinor: '10000' }]);
    const loanId = await recordCashLoan(client, ownerId, personalId, activeId, '3000');
    const categoryId = await createExpenseCategory(client, ownerId, personalId);
    await archiveWalletDirectly(client, archivedId);

    await expect(postEvent(client, ownerId, personalId, 'income', [{ walletId: archivedId, amountMinor: '100' }]))
      .rejects.toMatchObject(genericPostingError);
    await expect(postEvent(client, ownerId, personalId, 'transfer', [
      { walletId: activeId, amountMinor: '-100' },
      { walletId: archivedId, amountMinor: '100' },
    ])).rejects.toMatchObject(genericPostingError);
    await expect(postCategorizedExpense(client, ownerId, personalId, archivedId, categoryId, '-100'))
      .rejects.toMatchObject(genericPostingError);
    await expect(recordCashLoan(client, ownerId, personalId, archivedId, '100'))
      .rejects.toMatchObject(loanWalletError);
    await expect(repayLoan(client, ownerId, personalId, loanId, archivedId, '100'))
      .rejects.toMatchObject(loanWalletError);
    expect(await walletBalance(client, archivedId)).toBe('0');
    expect(await walletBalance(client, activeId)).toBe('7000');
  });

  it('accepts movements again once an archived wallet is active', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Returning USD');
    await archiveWalletDirectly(client, walletId);
    await client.query('update public.wallets set archived_at = null where id = $1', [walletId]);
    await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '250' }]);
    expect(await walletBalance(client, walletId)).toBe('250');
  });

  it('pins the active-wallet movement trigger and its definer function', async () => {
    const { client } = currentDatabase();
    const trigger = await client.query<Record<string, unknown>>(
      `select tgname, tgenabled, pg_get_triggerdef(oid) as definition
       from pg_trigger
       where tgrelid = 'public.wallet_movements'::regclass
         and tgname = 'wallet_movements_require_active_wallet'
       limit 2`,
    );
    expect(trigger.rows).toEqual([{
      tgname: 'wallet_movements_require_active_wallet', tgenabled: 'O',
      definition: 'CREATE TRIGGER wallet_movements_require_active_wallet BEFORE INSERT ON public.wallet_movements FOR EACH ROW EXECUTE FUNCTION private.require_active_movement_wallet()',
    }]);
    expect(await functionCatalog(client, ['private.require_active_movement_wallet()'])).toEqual([{
      signature: 'private.require_active_movement_wallet()', result: 'trigger', prosecdef: true, provolatile: 'v',
      proconfig: ['search_path=pg_catalog'],
      public_exec: false, anon_exec: false, authenticated_exec: false, service_exec: false,
    }]);
  });

  it('renames an active wallet, trims the name, and records the previous name', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Daily USD');
    const requestId = randomUUID();
    expect(await renameWallet(client, ownerId, {
      spaceId: personalId, requestId, walletId, name: '  Travel cash  ',
    })).toBe(walletId);
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Travel cash', currency: 'USD', archived_at: null });
    expect(await logRows(client, walletId)).toEqual([{
      request_id: requestId, command_kind: 'rename_wallet', wallet_id: walletId, actor_id: ownerId,
      previous_name: 'Daily USD', name: 'Travel cash',
    }]);
    expect(await commandResult(client, ownerId, personalId, requestId)).toEqual([
      { command_kind: 'rename_wallet', wallet_id: walletId },
    ]);
  });

  it('accepts a 120-character wallet name', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Short USD');
    await renameWallet(client, ownerId, {
      spaceId: personalId, requestId: randomUUID(), walletId, name: 'x'.repeat(120),
    });
    expect((await walletRow(client, walletId)).name).toHaveLength(120);
  });

  it('lets an active non-owner household member rename a household wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, householdId, 'Shared cash');
    await renameWallet(client, memberId, {
      spaceId: householdId, requestId: randomUUID(), walletId, name: 'Family cash',
    });
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Family cash' });
    expect((await logRows(client, walletId)).map(({ actor_id }) => actor_id)).toEqual([memberId]);
  });

  it('replays an exact rename once and rejects changed data under the same request', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Replay USD');
    const otherWalletId = await createWallet(client, ownerId, personalId, 'Other USD');
    const command: RenameCommand = { spaceId: personalId, requestId: randomUUID(), walletId, name: 'Replayed USD' };
    await renameWallet(client, ownerId, command);

    expect(await renameWallet(client, ownerId, command)).toBe(walletId);
    expect(await renameWallet(client, ownerId, { ...command, name: '  Replayed USD ' })).toBe(walletId);
    await expect(renameWallet(client, ownerId, { ...command, name: 'Changed USD' }))
      .rejects.toMatchObject(replayError);
    await expect(renameWallet(client, ownerId, { ...command, walletId: otherWalletId }))
      .rejects.toMatchObject(replayError);
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Replayed USD' });
    expect(await walletRow(client, otherWalletId)).toMatchObject({ name: 'Other USD' });
    expect(await logRows(client, walletId)).toHaveLength(1);
  });

  it.each([
    'outsider', 'null space', 'null request', 'null wallet', 'foreign wallet', 'archived wallet',
    'blank name', 'null name', 'long name', 'unchanged name',
  ] as const)('rejects a rename with %s without partial state', async (scenario) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Stable USD');
    const householdWalletId = await createWallet(client, ownerId, householdId, 'Household USD');
    if (scenario === 'archived wallet') {
      await archiveWalletDirectly(client, walletId);
    }
    const before = await walletRow(client, walletId);
    const command: RenameCommand = { spaceId: personalId, requestId: randomUUID(), walletId, name: 'Renamed USD' };
    let actorId = ownerId;
    let expected: { code: string; message: string } = nameLengthError;
    switch (scenario) {
      case 'outsider':
        actorId = outsiderId;
        expected = membershipError;
        break;
      case 'null space':
        command.spaceId = null;
        expected = membershipError;
        break;
      case 'null request':
        command.requestId = null;
        expected = missingIdsError;
        break;
      case 'null wallet':
        command.walletId = null;
        expected = missingIdsError;
        break;
      case 'foreign wallet':
        command.walletId = householdWalletId;
        expected = foreignWalletError;
        break;
      case 'archived wallet':
        expected = archivedWalletError;
        break;
      case 'blank name':
        command.name = '   ';
        break;
      case 'null name':
        command.name = null;
        break;
      case 'long name':
        command.name = 'x'.repeat(121);
        break;
      case 'unchanged name':
        command.name = ' Stable USD ';
        expected = sameNameError;
        break;
    }

    await expect(renameWallet(client, actorId, command)).rejects.toMatchObject(expected);
    expect(await walletRow(client, walletId)).toEqual(before);
    expect(await logRows(client, walletId)).toEqual([]);
    expect(await walletRow(client, householdWalletId)).toMatchObject({ name: 'Household USD' });
    expect(await logRows(client, householdWalletId)).toEqual([]);
  });

  it.each(['anon', 'service_role'] as const)('denies the %s role rename and result lookup', async (role) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Role USD');
    await withRollback(client, async () => {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query(`set local role ${role}`);
      await expectSavepointRejection(client, () => client.query(
        "select * from public.rename_wallet($1, $2, $3, 'Blocked USD')", [personalId, randomUUID(), walletId],
      ), { code: '42501' });
      await expectSavepointRejection(client, () => client.query(
        'select * from public.get_wallet_command_result($1, $2)', [personalId, randomUUID()],
      ), { code: '42501' });
    });
    expect(await walletRow(client, walletId)).toMatchObject({ name: 'Role USD' });
  });

  it('returns a wallet command result only to active members of its space', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, householdId, 'Lookup USD');
    const requestId = randomUUID();
    await renameWallet(client, ownerId, { spaceId: householdId, requestId, walletId, name: 'Looked up USD' });

    expect(await commandResult(client, memberId, householdId, requestId)).toEqual([
      { command_kind: 'rename_wallet', wallet_id: walletId },
    ]);
    expect(await commandResult(client, memberId, householdId, randomUUID())).toEqual([]);
    await expect(commandResult(client, outsiderId, householdId, requestId)).rejects.toMatchObject(membershipError);
  });

  it('pins rename, result, and helper signatures, search paths, and execute grants', async () => {
    const { client } = currentDatabase();
    const command = { public_exec: false, anon_exec: false, authenticated_exec: true, service_exec: false };
    const helper = { public_exec: false, anon_exec: false, authenticated_exec: false, service_exec: false };
    expect(await functionCatalog(client, [
      'public.get_wallet_command_result(uuid,uuid)',
      'private.lock_space_wallet(uuid,uuid)',
      'private.replay_wallet_command(uuid,uuid,text,bytea,uuid)',
      'private.require_wallet_command_actor(uuid,uuid,uuid)',
      'public.rename_wallet(uuid,uuid,uuid,text)',
    ])).toEqual([
      {
        signature: 'get_wallet_command_result(uuid,uuid)',
        result: 'TABLE(command_kind text, wallet_id uuid, created_at timestamp with time zone)',
        prosecdef: true, provolatile: 's', proconfig: ['search_path=pg_catalog'], ...command,
      },
      {
        signature: 'private.lock_space_wallet(uuid,uuid)', result: 'wallets',
        prosecdef: false, provolatile: 'v', proconfig: ['search_path=pg_catalog'], ...helper,
      },
      {
        signature: 'private.replay_wallet_command(uuid,uuid,text,bytea,uuid)', result: 'boolean',
        prosecdef: false, provolatile: 'v', proconfig: ['search_path=pg_catalog'], ...helper,
      },
      {
        signature: 'private.require_wallet_command_actor(uuid,uuid,uuid)', result: 'uuid',
        prosecdef: false, provolatile: 's', proconfig: ['search_path=pg_catalog'], ...helper,
      },
      {
        signature: 'rename_wallet(uuid,uuid,uuid,text)', result: 'TABLE(id uuid)',
        prosecdef: true, provolatile: 'v', proconfig: ['search_path=pg_catalog, extensions'], ...command,
      },
    ]);
  });

  it('archives a zero-balance wallet and keeps its movement history', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Emptied USD');
    await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '900' }]);
    await postEvent(client, ownerId, personalId, 'expense', [{ walletId, amountMinor: '-900' }]);
    const requestId = randomUUID();

    expect(await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId, walletId,
    })).toBe(walletId);
    const archived = await walletRow(client, walletId);
    expect(archived.archived_at).toBeInstanceOf(Date);
    expect(archived.name).toBe('Emptied USD');
    const movements = await client.query(
      'select id from public.wallet_movements where wallet_id = $1 limit 3', [walletId],
    );
    expect(movements.rows).toHaveLength(2);
    expect(await logRows(client, walletId)).toEqual([{
      request_id: requestId, command_kind: 'archive_wallet', wallet_id: walletId, actor_id: ownerId,
      previous_name: null, name: null,
    }]);
    expect(await commandResult(client, ownerId, personalId, requestId)).toEqual([
      { command_kind: 'archive_wallet', wallet_id: walletId },
    ]);
  });

  it('archives a wallet that never had a movement', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Unused USD');
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });
    expect((await walletRow(client, walletId)).archived_at).toBeInstanceOf(Date);
  });

  it.each([
    ['positive', 'income', '1250'],
    ['negative', 'expense', '-1250'],
  ] as const)('refuses to archive a wallet with a %s balance', async (_label, kind, amountMinor) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, `Funded ${amountMinor}`);
    await postEvent(client, ownerId, personalId, kind, [{ walletId, amountMinor }]);

    await expect(walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    })).rejects.toMatchObject(nonZeroBalanceError);
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
    expect(await walletBalance(client, walletId)).toBe(amountMinor);
    expect(await logRows(client, walletId)).toEqual([]);
  });

  it('replays an exact archive without rewriting its timestamp or touching another wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Replay archive USD');
    const otherWalletId = await createWallet(client, ownerId, personalId, 'Other archive USD');
    const command: WalletCommand = { spaceId: personalId, requestId: randomUUID(), walletId };
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', command);
    const archivedAt = (await walletRow(client, walletId)).archived_at;

    expect(await walletLifecycleCommand(client, ownerId, 'archive_wallet', command)).toBe(walletId);
    expect((await walletRow(client, walletId)).archived_at).toEqual(archivedAt);
    await expect(walletLifecycleCommand(client, ownerId, 'archive_wallet', { ...command, walletId: otherWalletId }))
      .rejects.toMatchObject(replayError);
    await expect(walletLifecycleCommand(client, ownerId, 'restore_wallet', command))
      .rejects.toMatchObject(replayError);
    expect(await walletRow(client, otherWalletId)).toMatchObject({ archived_at: null });
    expect(await logRows(client, walletId)).toHaveLength(1);
  });

  it('rejects archiving an archived wallet and restoring an active wallet', async () => {
    const { client } = currentDatabase();
    const archivedId = await createWallet(client, ownerId, personalId, 'Twice archived USD');
    const activeId = await createWallet(client, ownerId, personalId, 'Never archived USD');
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId: archivedId,
    });

    await expect(walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId: archivedId,
    })).rejects.toMatchObject(alreadyArchivedError);
    await expect(walletLifecycleCommand(client, ownerId, 'restore_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId: activeId,
    })).rejects.toMatchObject(notArchivedError);
    expect(await logRows(client, archivedId)).toHaveLength(1);
    expect(await logRows(client, activeId)).toEqual([]);
  });

  it('restores an archived wallet so it accepts postings and renames again', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Restored USD');
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });
    const restoreRequestId = randomUUID();

    expect(await walletLifecycleCommand(client, ownerId, 'restore_wallet', {
      spaceId: personalId, requestId: restoreRequestId, walletId,
    })).toBe(walletId);
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
    await postEvent(client, ownerId, personalId, 'income', [{ walletId, amountMinor: '300' }]);
    await renameWallet(client, ownerId, { spaceId: personalId, requestId: randomUUID(), walletId, name: 'Back USD' });
    expect(await walletBalance(client, walletId)).toBe('300');
    expect((await logRows(client, walletId)).map(({ command_kind }) => command_kind))
      .toEqual(['archive_wallet', 'restore_wallet', 'rename_wallet']);
    expect(await commandResult(client, ownerId, personalId, restoreRequestId)).toEqual([
      { command_kind: 'restore_wallet', wallet_id: walletId },
    ]);
  });

  it('replays an exact restore without re-applying it after a later archive', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Replay restore USD');
    const restore: WalletCommand = { spaceId: personalId, requestId: randomUUID(), walletId };
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });
    await walletLifecycleCommand(client, ownerId, 'restore_wallet', restore);
    await walletLifecycleCommand(client, ownerId, 'archive_wallet', {
      spaceId: personalId, requestId: randomUUID(), walletId,
    });

    expect(await walletLifecycleCommand(client, ownerId, 'restore_wallet', restore)).toBe(walletId);
    expect((await walletRow(client, walletId)).archived_at).toBeInstanceOf(Date);
    expect(await logRows(client, walletId)).toHaveLength(3);
  });

  it('lets an active non-owner household member archive and restore a household wallet', async () => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, householdId, 'Envelope LBP', 'LBP');
    await walletLifecycleCommand(client, memberId, 'archive_wallet', {
      spaceId: householdId, requestId: randomUUID(), walletId,
    });
    await walletLifecycleCommand(client, memberId, 'restore_wallet', {
      spaceId: householdId, requestId: randomUUID(), walletId,
    });
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
    expect((await logRows(client, walletId)).map(({ actor_id }) => actor_id)).toEqual([memberId, memberId]);
  });

  it.each([
    ['archive_wallet', 'outsider'], ['archive_wallet', 'null space'], ['archive_wallet', 'null request'],
    ['archive_wallet', 'null wallet'], ['archive_wallet', 'foreign wallet'],
    ['restore_wallet', 'outsider'], ['restore_wallet', 'null space'], ['restore_wallet', 'null request'],
    ['restore_wallet', 'null wallet'], ['restore_wallet', 'foreign wallet'],
  ] as const)('rejects %s with %s without partial state', async (commandName, scenario) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Guarded USD');
    const householdWalletId = await createWallet(client, ownerId, householdId, 'Guarded household USD');
    if (commandName === 'restore_wallet') {
      await archiveWalletDirectly(client, walletId);
      await archiveWalletDirectly(client, householdWalletId);
    }
    const before = await walletRow(client, walletId);
    const householdBefore = await walletRow(client, householdWalletId);
    const input: WalletCommand = { spaceId: personalId, requestId: randomUUID(), walletId };
    let actorId = ownerId;
    let expected: { code: string; message: string } = membershipError;
    switch (scenario) {
      case 'outsider':
        actorId = outsiderId;
        break;
      case 'null space':
        input.spaceId = null;
        break;
      case 'null request':
        input.requestId = null;
        expected = missingIdsError;
        break;
      case 'null wallet':
        input.walletId = null;
        expected = missingIdsError;
        break;
      case 'foreign wallet':
        input.walletId = householdWalletId;
        expected = foreignWalletError;
        break;
    }

    await expect(walletLifecycleCommand(client, actorId, commandName, input)).rejects.toMatchObject(expected);
    expect(await walletRow(client, walletId)).toEqual(before);
    expect(await walletRow(client, householdWalletId)).toEqual(householdBefore);
    expect(await logRows(client, walletId)).toEqual([]);
    expect(await logRows(client, householdWalletId)).toEqual([]);
  });

  it.each(['anon', 'service_role'] as const)('denies the %s role archive and restore', async (role) => {
    const { client } = currentDatabase();
    const walletId = await createWallet(client, ownerId, personalId, 'Role archive USD');
    await withRollback(client, async () => {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await client.query(`set local role ${role}`);
      for (const command of ['archive_wallet', 'restore_wallet'] as const) {
        await expectSavepointRejection(client, () => client.query(
          `select * from public.${command}($1, $2, $3)`, [personalId, randomUUID(), walletId],
        ), { code: '42501' });
      }
    });
    expect(await walletRow(client, walletId)).toMatchObject({ archived_at: null });
  });

  it('pins archive and restore signatures, search paths, and execute grants', async () => {
    const { client } = currentDatabase();
    const command = {
      result: 'TABLE(id uuid)', prosecdef: true, provolatile: 'v', proconfig: ['search_path=pg_catalog, extensions'],
      public_exec: false, anon_exec: false, authenticated_exec: true, service_exec: false,
    };
    expect(await functionCatalog(client, [
      'public.archive_wallet(uuid,uuid,uuid)',
      'public.restore_wallet(uuid,uuid,uuid)',
    ])).toEqual([
      { signature: 'archive_wallet(uuid,uuid,uuid)', ...command },
      { signature: 'restore_wallet(uuid,uuid,uuid)', ...command },
    ]);
  });

  it('fails a posting that waits behind a committed archive of the same wallet', async () => {
    const database = currentDatabase();
    const walletId = await createWallet(database.client, ownerId, personalId, 'Race archive first');
    const postingRequestId = randomUUID();

    const outcome = await orderedAuthenticatedRace(
      database,
      ownerId,
      (client) => archiveInOpenTransaction(client, personalId, walletId),
      (client) => postIncomeInOpenTransaction(client, personalId, walletId, postingRequestId),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: expect.objectContaining(inactiveMovementError) });
    expect((await walletRow(database.client, walletId)).archived_at).toBeInstanceOf(Date);
    expect(await walletBalance(database.client, walletId)).toBe('0');
    const posted = await database.client.query(
      'select id from public.financial_events where space_id = $1 and request_id = $2 limit 2',
      [personalId, postingRequestId],
    );
    expect(posted.rows).toEqual([]);
  });

  it('fails an archive that waits behind a committed posting to the same wallet', async () => {
    const database = currentDatabase();
    const walletId = await createWallet(database.client, ownerId, personalId, 'Race posting first');

    const outcome = await orderedAuthenticatedRace(
      database,
      ownerId,
      (client) => postIncomeInOpenTransaction(client, personalId, walletId, randomUUID()),
      (client) => archiveInOpenTransaction(client, personalId, walletId),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: expect.objectContaining(nonZeroBalanceError) });
    expect(await walletRow(database.client, walletId)).toMatchObject({ archived_at: null });
    expect(await walletBalance(database.client, walletId)).toBe('500');
    expect(await logRows(database.client, walletId)).toEqual([]);
  });
});
