import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  asUser,
  closeDatabase,
  databaseQuery,
  ensureAuthUser,
  withAdminTransaction,
  withAnonymousSession,
  withUserSession,
} from './test-database.js';

const ownerId = '00000000-0000-4000-9000-000000000001';
const memberId = '00000000-0000-4000-9000-000000000002';
const unrelatedId = '00000000-0000-4000-9000-000000000003';

afterAll(async () => {
  await closeDatabase();
});

async function addActiveMember(spaceId: string, userId: string, role: 'owner' | 'member') {
  await ensureAuthUser(userId, `${userId}@budget.invalid`);
  await databaseQuery(
    `insert into public.space_memberships (space_id, user_id, role)
     values ($1, $2, $3::public.member_role)`,
    [spaceId, userId, role],
  );
}

describe('household membership schema boundary', () => {
  it('creates the exact lifecycle types, named constraints, indexes, and deferred triggers', async () => {
    const enumRows = await databaseQuery<{ type_name: string; labels: string[] }>(
      `select type.typname as type_name,
              array_agg(enum.enumlabel::text order by enum.enumsortorder) as labels
       from pg_type as type
       join pg_enum as enum on enum.enumtypid = type.oid
       join pg_namespace as namespace on namespace.oid = type.typnamespace
       where namespace.nspname = 'public'
         and type.typname in ('membership_status', 'household_invitation_status',
           'household_membership_event_kind')
       group by type.typname
       order by type.typname`,
    );
    expect(enumRows).toEqual([
      {
        type_name: 'household_invitation_status',
        labels: ['pending', 'accepted', 'cancelled'],
      },
      {
        type_name: 'household_membership_event_kind',
        labels: [
          'invitation_created',
          'invitation_cancelled',
          'invitation_accepted',
          'member_removed',
          'member_left',
          'member_promoted',
          'member_demoted',
        ],
      },
      { type_name: 'membership_status', labels: ['active', 'revoked', 'left'] },
    ]);

    const constraints = await databaseQuery<{ conname: string }>(
      `select conname
       from pg_constraint
       where conname = any($1::text[])
       order by conname`,
      [[
        'household_invitation_expiry_check',
        'household_invitation_identity_digest_check',
        'household_invitation_key_lengths_check',
        'household_invitation_key_retirement_check',
        'household_invitation_lifecycle_check',
        'household_invitation_token_digest_check',
        'household_membership_events_actor_request_key',
        'household_membership_events_shape_check',
        'space_memberships_end_actor_check',
        'space_memberships_lifecycle_check',
        'space_memberships_lifecycle_time_check',
      ]],
    );
    expect(constraints.map(({ conname }) => conname)).toHaveLength(11);

    const indexes = await databaseQuery<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname in ('public', 'private')
         and indexname = any($1::text[])
       order by indexname`,
      [[
        'household_invitation_keys_one_active_idx',
        'household_invitations_key_version_idx',
        'household_invitations_pending_identity_idx',
        'household_invitations_space_created_idx',
        'household_membership_events_space_time_idx',
        'space_memberships_active_owner_idx',
        'space_memberships_active_user_space_idx',
        'space_memberships_ended_by_idx',
      ]],
    );
    expect(indexes.map(({ indexname }) => indexname)).toHaveLength(8);

    const triggers = await databaseQuery<{ tgname: string; deferred: boolean }>(
      `select trigger.tgname, trigger.tgdeferrable and trigger.tginitdeferred as deferred
       from pg_trigger as trigger
       where not trigger.tgisinternal
         and trigger.tgname = any($1::text[])
       order by trigger.tgname`,
      [[
        'household_invitations_require_household_space',
        'space_memberships_preserve_space_owners',
        'spaces_preserve_membership_invariants',
      ]],
    );
    expect(triggers).toEqual([
      { tgname: 'household_invitations_require_household_space', deferred: true },
      { tgname: 'space_memberships_preserve_space_owners', deferred: true },
      { tgname: 'spaces_preserve_membership_invariants', deferred: true },
    ]);
  });

  it('backfills lifecycle state and makes inactive membership fail closed everywhere', async () => {
    const owner = asUser(ownerId);
    const household = await owner.createSpace(`Household ${randomUUID()}`, 'household');
    await addActiveMember(household.id, memberId, 'member');

    const active = await databaseQuery<{
      status: string;
      activated_matches_created: boolean;
      ended_at: string | null;
    }>(
      `select status::text,
              activated_at = created_at as activated_matches_created,
              ended_at::text
       from public.space_memberships
       where space_id = $1 and user_id = $2`,
      [household.id, memberId],
    );
    expect(active).toEqual([
      { status: 'active', activated_matches_created: true, ended_at: null },
    ]);

    await expect(asUser(memberId).createWallet(household.id, 'Before revoke', 'USD')).resolves.toEqual({
      id: expect.any(String),
    });
    await databaseQuery(
      `update public.space_memberships
       set status = 'revoked', ended_at = now(), ended_by_user_id = $3
       where space_id = $1 and user_id = $2`,
      [household.id, memberId, ownerId],
    );

    await expect(asUser(memberId).createWallet(household.id, 'After revoke', 'USD')).rejects.toMatchObject({
      code: '42501',
      message: 'an active space membership is required',
    });
    await expect(
      withUserSession(memberId, async (client) =>
        client.query('select id from public.spaces where id = $1', [household.id]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      withUserSession(memberId, async (client) =>
        client.query(
          'select status::text from public.space_memberships where space_id = $1',
          [household.id],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'revoked' }] });
  });

  it('rejects personal-space membership and invitation corruption at commit', async () => {
    const personal = await asUser(ownerId).createSpace(`Personal ${randomUUID()}`, 'personal');
    await ensureAuthUser(unrelatedId, `${unrelatedId}@budget.invalid`);

    await expect(
      withAdminTransaction(async (client) => {
        await client.query(
          `insert into public.space_memberships (space_id, user_id, role)
           values ($1, $2, 'member')`,
          [personal.id, unrelatedId],
        );
      }),
    ).rejects.toMatchObject({ message: 'personal space membership invariant violated' });

    const key = await databaseQuery<{ key_version: number }>(
      `select key_version from private.household_invitation_keys where retired_at is null`,
    );
    await expect(
      withAdminTransaction(async (client) => {
        await client.query(
          `insert into public.household_invitations (
             space_id, key_version, invitee_identity_digest, token_digest,
             status, created_by_user_id, created_at, expires_at
           ) values ($1, $2, decode(repeat('11', 32), 'hex'), decode(repeat('22', 32), 'hex'),
             'pending', $3, now(), now() + interval '7 days')`,
          [personal.id, key[0]?.key_version, ownerId],
        );
      }),
    ).rejects.toMatchObject({ message: 'household invitations require a household space' });
  });

  it('uses a dedicated non-login owner, forced RLS, and no client or background writes', async () => {
    const roleRows = await databaseQuery<{
      rolcanlogin: boolean;
      rolinherit: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolcanlogin, rolinherit, rolsuper, rolbypassrls
       from pg_roles where rolname = 'household_command_owner'`,
    );
    expect(roleRows).toEqual([
      { rolcanlogin: false, rolinherit: false, rolsuper: false, rolbypassrls: false },
    ]);

    const relationRows = await databaseQuery<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      authenticated_writes: boolean;
      service_writes: boolean;
    }>(
      `select class.relname, class.relrowsecurity, class.relforcerowsecurity,
              has_table_privilege('authenticated', class.oid, 'insert,update,delete,truncate') as authenticated_writes,
              has_table_privilege('service_role', class.oid, 'insert,update,delete,truncate') as service_writes
       from pg_class as class
       join pg_namespace as namespace on namespace.oid = class.relnamespace
       where namespace.nspname = 'public'
         and class.relname in ('household_invitations', 'household_membership_events')
       order by class.relname`,
    );
    expect(relationRows).toEqual([
      {
        relname: 'household_invitations',
        relrowsecurity: true,
        relforcerowsecurity: true,
        authenticated_writes: false,
        service_writes: false,
      },
      {
        relname: 'household_membership_events',
        relrowsecurity: true,
        relforcerowsecurity: true,
        authenticated_writes: false,
        service_writes: false,
      },
    ]);
  });

  it('keeps HMAC keys inaccessible to application and background roles', async () => {
    await expect(
      withUserSession(ownerId, async (client) =>
        client.query('select identity_hmac_key from private.household_invitation_keys'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withAnonymousSession(async (client) =>
        client.query('select token_hmac_key from private.household_invitation_keys'),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const servicePrivileges = await databaseQuery<{ readable: boolean; writable: boolean }>(
      `select
         has_table_privilege('service_role', 'private.household_invitation_keys', 'select') as readable,
         has_table_privilege('service_role', 'private.household_invitation_keys', 'insert,update,delete,truncate') as writable`,
    );
    expect(servicePrivileges).toEqual([{ readable: false, writable: false }]);
  });

  it('rejects membership-event UPDATE, DELETE, and TRUNCATE after deliberate ACL and RLS weakening', async () => {
    const household = await asUser(ownerId).createSpace(`Audit ${randomUUID()}`, 'household');
    const key = await databaseQuery<{ key_version: number }>(
      `select key_version from private.household_invitation_keys where retired_at is null`,
    );
    const invitationId = randomUUID();
    await databaseQuery(
      `insert into public.household_invitations (
         id, space_id, key_version, invitee_identity_digest, token_digest,
         status, created_by_user_id, created_at, expires_at
       ) values ($1::uuid, $2, $3, decode(repeat('44', 32), 'hex'), extensions.digest($1::text, 'sha256'),
         'pending', $4, now(), now() + interval '7 days')`,
      [invitationId, household.id, key[0]?.key_version, ownerId],
    );
    const eventId = randomUUID();
    await databaseQuery(
      `insert into public.household_membership_events (
         id, space_id, actor_user_id, request_id, request_fingerprint, kind, invitation_id
       ) values ($1, $2, $3, $4, decode(repeat('33', 32), 'hex'), 'invitation_created', $5)`,
      [eventId, household.id, ownerId, randomUUID(), invitationId],
    );
    await databaseQuery(
      `grant select, update, delete, truncate on public.household_membership_events to authenticated`,
    );
    await databaseQuery(
      `create policy household_events_test_write on public.household_membership_events
       for all to authenticated using (true) with check (true)`,
    );

    try {
      await expect(
        withUserSession(ownerId, async (client) =>
          client.query(
            'update public.household_membership_events set occurred_at = occurred_at where id = $1',
            [eventId],
          ),
        ),
      ).rejects.toMatchObject({ message: 'household membership events are immutable' });
      await expect(
        withUserSession(ownerId, async (client) =>
          client.query('delete from public.household_membership_events where id = $1', [eventId]),
        ),
      ).rejects.toMatchObject({ message: 'household membership events are immutable' });
      await expect(
        withUserSession(ownerId, async (client) =>
          client.query('truncate public.household_membership_events'),
        ),
      ).rejects.toMatchObject({ message: 'household membership events are immutable' });
    } finally {
      await databaseQuery(
        'drop policy if exists household_events_test_write on public.household_membership_events',
      );
      await databaseQuery(
        'revoke select, update, delete, truncate on public.household_membership_events from authenticated',
      );
    }
  });
});
