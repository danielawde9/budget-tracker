import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = join(process.cwd(), 'supabase', 'migrations');
const householdStart = '20260908170000';
const migrationLimit = 100;

interface MigrationFile {
  name: string;
  path: string;
  version: string;
}

interface MembershipProof {
  activated_matches_created: boolean;
  created_at: string;
  role: string;
  status: string;
  user_id: string;
}

interface FinancialProof {
  event_count: string;
  loan_posting_total: string;
  movement_total: string;
}

interface MigrationProof {
  activeKeyCount: string;
  commandCount: string;
  constraintCount: string;
  exactCommandAclCount: string;
  forcedRlsCount: string;
  indexCount: string;
  journalCount: string;
  memberships?: MembershipProof[];
  policyCount: string;
  preservedFinancials?: FinancialProof;
  financialSnapshotPreserved?: boolean;
  triggerCount: string;
}

function databaseUrl(): string {
  const value = process.env.BUDGET_TEST_DATABASE_URL;
  if (!value) throw new Error('BUDGET_TEST_DATABASE_URL is required');
  return value;
}

function migrationFiles(): MigrationFile[] {
  const files = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name: basename(name, '.sql').slice(15),
      path: join(migrationsDirectory, name),
      version: name.slice(0, 14),
    }));
  if (files.length < 1 || files.length > migrationLimit) {
    throw new Error(`migration count must be between 1 and ${migrationLimit}`);
  }
  return files;
}

function disposableDatabaseUrl(name: string): string {
  const url = new URL(databaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

async function bootstrap(client: Client): Promise<void> {
  await client.query(`
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz
    );
    create function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = pg_catalog
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text primary key,
      statements text[] not null default array[]::text[],
      name text
    );
  `);
}

async function applyMigrations(client: Client, files: MigrationFile[]): Promise<void> {
  for (const file of files) {
    await client.query('begin');
    try {
      await client.query(readFileSync(file.path, 'utf8'));
      await client.query(
        `insert into supabase_migrations.schema_migrations (version, statements, name)
         values ($1, array[]::text[], $2)`,
        [file.version, file.name],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
}

async function seedPreHouseholdDatabase(client: Client): Promise<void> {
  await client.query(
    `insert into auth.users (id, email, email_confirmed_at) values
       ('10000000-0000-4000-a000-000000000001', 'migration-owner@budget.invalid', now()),
       ('10000000-0000-4000-a000-000000000002', 'migration-member@budget.invalid', now());
     insert into public.spaces (id, kind, name, created_at) values
       ('20000000-0000-4000-a000-000000000001', 'personal', 'Seed personal', '2026-01-01T00:00:00Z'),
       ('20000000-0000-4000-a000-000000000002', 'household', 'Seed household', '2026-01-02T00:00:00Z');
     insert into public.space_memberships (space_id, user_id, role, created_at) values
       ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'owner', '2026-01-01T00:00:01Z'),
       ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'owner', '2026-01-02T00:00:01Z'),
       ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000002', 'member', '2026-01-03T00:00:01Z');
     insert into public.wallets (id, space_id, name, currency) values
       ('30000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002', 'Seed USD', 'USD');
     insert into public.financial_events (
       id, space_id, request_id, request_fingerprint, kind, effective_date, actor_id
     ) values
       ('40000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
        '50000000-0000-4000-a000-000000000001', decode(repeat('11', 32), 'hex'), 'income',
        '2026-01-04', '10000000-0000-4000-a000-000000000001'),
       ('40000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000002',
        '50000000-0000-4000-a000-000000000002', decode(repeat('22', 32), 'hex'), 'loan_opening',
        '2026-01-05', '10000000-0000-4000-a000-000000000001');
     insert into public.wallet_movements (event_id, space_id, wallet_id, amount_minor) values
       ('40000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
        '30000000-0000-4000-a000-000000000001', 4242);
     insert into public.loans (
       id, space_id, direction, person_name, currency, effective_date, actor_id
     ) values (
       '60000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
       'they_owe_me', 'Seed borrower', 'USD', '2026-01-05',
       '10000000-0000-4000-a000-000000000001'
     );
     insert into public.loan_postings (event_id, loan_id, space_id, principal_delta_minor) values
       ('40000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000002', 9876);`,
  );
}

async function financialSnapshot(client: Client): Promise<string> {
  const result = await client.query<{ snapshot: string }>(
    `select jsonb_build_object(
       'wallets', (select jsonb_agg(to_jsonb(row) order by row.id) from public.wallets as row),
       'events', (select jsonb_agg(to_jsonb(row) order by row.id) from public.financial_events as row),
       'movements', (select jsonb_agg(to_jsonb(row) order by row.id) from public.wallet_movements as row),
       'loans', (select jsonb_agg(to_jsonb(row) order by row.id) from public.loans as row),
       'postings', (select jsonb_agg(to_jsonb(row) order by row.event_id) from public.loan_postings as row)
     )::text as snapshot`,
  );
  return result.rows[0]!.snapshot;
}

async function proofResult(client: Client, seeded: boolean): Promise<MigrationProof> {
  const catalog = await client.query<{
    active_key_count: string;
    command_count: string;
    constraint_count: string;
    exact_command_acl_count: string;
    forced_rls_count: string;
    index_count: string;
    journal_count: string;
    policy_count: string;
    trigger_count: string;
  }>(
    `select
       (select count(*)::text from private.household_invitation_keys
        where retired_at is null) as active_key_count,
       (select count(*)::text from pg_proc as procedure
        join pg_namespace as namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public' and procedure.proname = any($1::text[])) as command_count,
       (select count(*)::text from pg_constraint where conname = any($2::text[])) as constraint_count,
       (select count(*)::text from pg_indexes
        where schemaname in ('public', 'private') and indexname = any($3::text[])) as index_count,
       (select count(*)::text from pg_trigger
        where not tgisinternal and tgname = any($4::text[])) as trigger_count,
       (select count(*)::text from pg_policies
        where schemaname = 'public' and policyname = any($5::text[])) as policy_count,
       (select count(*)::text from pg_class as relation
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = any(array['household_invitations', 'household_membership_events'])
          and relation.relrowsecurity and relation.relforcerowsecurity) as forced_rls_count,
       (select count(*)::text from pg_proc as procedure
        join pg_namespace as namespace on namespace.oid = procedure.pronamespace
        join pg_roles as owner on owner.oid = procedure.proowner
        where namespace.nspname = 'public' and procedure.proname = any($1::text[])
          and owner.rolname = 'household_command_owner'
          and has_function_privilege('authenticated', procedure.oid, 'execute')
          and not has_function_privilege('anon', procedure.oid, 'execute')
          and not has_function_privilege('service_role', procedure.oid, 'execute'))
        as exact_command_acl_count,
       (select count(*)::text from supabase_migrations.schema_migrations) as journal_count`,
    [[
      'create_household_invitation', 'accept_household_invitation',
      'cancel_household_invitation', 'set_household_member_role',
      'remove_household_member', 'leave_household_space',
      'list_household_members', 'list_household_invitations',
    ], [
      'household_invitation_expiry_check', 'household_invitation_identity_digest_check',
      'household_invitation_key_lengths_check', 'household_invitation_key_retirement_check',
      'household_invitation_lifecycle_check', 'household_invitation_token_digest_check',
      'household_membership_events_actor_request_key', 'household_membership_events_shape_check',
      'space_memberships_end_actor_check', 'space_memberships_lifecycle_check',
      'space_memberships_lifecycle_time_check',
    ], [
      'household_invitation_keys_one_active_idx', 'household_invitations_key_version_idx',
      'household_invitations_pending_identity_idx', 'household_invitations_space_created_idx',
      'household_membership_events_space_time_idx', 'space_memberships_active_owner_idx',
      'space_memberships_active_user_space_idx', 'space_memberships_ended_by_idx',
    ], [
      'household_invitations_require_household_space',
      'space_memberships_preserve_space_owners', 'spaces_preserve_membership_invariants',
      'household_membership_events_reject_row_mutation',
      'household_membership_events_reject_delete_statement',
      'household_membership_events_reject_truncate',
    ], [
      'space_memberships_household_command_owner', 'household_invitations_command_owner',
      'household_membership_events_command_owner',
    ]],
  );
  const row = catalog.rows[0]!;
  const proof: MigrationProof = {
    activeKeyCount: row.active_key_count,
    commandCount: row.command_count,
    constraintCount: row.constraint_count,
    exactCommandAclCount: row.exact_command_acl_count,
    forcedRlsCount: row.forced_rls_count,
    indexCount: row.index_count,
    journalCount: row.journal_count,
    policyCount: row.policy_count,
    triggerCount: row.trigger_count,
  };
  if (!seeded) return proof;

  const memberships = await client.query<MembershipProof>(
    `select user_id::text, role::text, status::text, created_at::text,
            activated_at = created_at as activated_matches_created
     from public.space_memberships order by space_id, user_id`,
  );
  const financials = await client.query<FinancialProof>(
    `select
       (select count(*)::text from public.financial_events) as event_count,
       (select sum(amount_minor)::text from public.wallet_movements) as movement_total,
       (select sum(principal_delta_minor)::text from public.loan_postings) as loan_posting_total`,
  );
  return { ...proof, memberships: memberships.rows, preservedFinancials: financials.rows[0]! };
}

async function verifyHouseholdMigrations(seeded: boolean): Promise<MigrationProof> {
  const name = `budget_household_migration_${randomBytes(6).toString('hex')}`;
  if (!/^budget_household_migration_[0-9a-f]{12}$/.test(name)) {
    throw new Error('refusing unsafe disposable database name');
  }
  const admin = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 10_000 });
  let database: Client | undefined;
  await admin.connect();
  try {
    await admin.query(`create database "${name}" template template0`);
    database = new Client({
      connectionString: disposableDatabaseUrl(name),
      connectionTimeoutMillis: 10_000,
    });
    await database.connect();
    await bootstrap(database);
    const files = migrationFiles();
    const baseline = files.filter((file) => file.version < householdStart);
    const household = files.filter((file) => file.version >= householdStart);
    await applyMigrations(database, seeded ? baseline : files);
    let beforeFinancials: string | undefined;
    if (seeded) {
      await seedPreHouseholdDatabase(database);
      beforeFinancials = await financialSnapshot(database);
      await applyMigrations(database, household);
    }
    const proof = await proofResult(database, seeded);
    if (beforeFinancials) {
      proof.financialSnapshotPreserved = (await financialSnapshot(database)) === beforeFinancials;
    }
    return proof;
  } finally {
    await database?.end();
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    );
    await admin.query(`drop database if exists "${name}"`);
    await admin.end();
  }
}

describe('household migration journal', () => {
  it('applies from an empty database', async () => {
    const proof = await verifyHouseholdMigrations(false);
    expect(proof).toEqual({
      activeKeyCount: '1',
      commandCount: '8',
      constraintCount: '11',
      exactCommandAclCount: '8',
      forcedRlsCount: '2',
      indexCount: '8',
      journalCount: '26',
      policyCount: '3',
      triggerCount: '6',
    });
  });

  it('backfills memberships and preserves seeded financial data', async () => {
    const proof = await verifyHouseholdMigrations(true);
    expect(proof.journalCount).toBe('26');
    expect(proof.commandCount).toBe('8');
    expect(proof.memberships).toHaveLength(3);
    expect(proof.memberships?.every((row) => row.status === 'active')).toBe(true);
    expect(proof.memberships?.every((row) => row.activated_matches_created)).toBe(true);
    expect(proof.memberships?.map(({ role }) => role)).toEqual(['owner', 'owner', 'member']);
    expect(proof.financialSnapshotPreserved).toBe(true);
    expect(proof.preservedFinancials).toEqual({
      event_count: '2',
      loan_posting_total: '9876',
      movement_total: '4242',
    });
  });
});
