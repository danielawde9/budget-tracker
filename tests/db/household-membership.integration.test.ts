import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  asUser,
  closeDatabase,
  databaseQuery,
  ensureAuthUser,
  runConcurrentUserActions,
  withAdminTransaction,
  withAnonymousSession,
  withUserSession,
} from './test-database.js';

interface CreatedInvitation {
  invitation_id: string;
  invitation_token: string;
  expires_at: Date;
}

interface AcceptedInvitation {
  space_id: string;
  membership_status: 'active';
  role: 'member';
}

async function acceptInvitation(
  userId: string,
  requestId: string,
  token: string,
): Promise<AcceptedInvitation> {
  return withUserSession(userId, async (client) => {
    const result = await client.query<AcceptedInvitation>(
      'select * from public.accept_household_invitation($1, $2)',
      [requestId, token],
    );
    const accepted = result.rows[0];
    if (!accepted) throw new Error('accept_household_invitation returned no row');
    return accepted;
  });
}

async function cancelInvitation(
  userId: string,
  spaceId: string,
  requestId: string,
  invitationId: string,
): Promise<{ invitation_id: string; status: 'cancelled' }> {
  return withUserSession(userId, async (client) => {
    const result = await client.query<{ invitation_id: string; status: 'cancelled' }>(
      'select * from public.cancel_household_invitation($1, $2, $3)',
      [spaceId, requestId, invitationId],
    );
    const cancelled = result.rows[0];
    if (!cancelled) throw new Error('cancel_household_invitation returned no row');
    return cancelled;
  });
}

async function createInvitation(
  userId: string,
  spaceId: string,
  requestId: string,
  email: string,
): Promise<CreatedInvitation> {
  return withUserSession(userId, async (client) => {
    const result = await client.query<CreatedInvitation>(
      'select * from public.create_household_invitation($1, $2, $3)',
      [spaceId, requestId, email],
    );
    const invitation = result.rows[0];
    if (!invitation) throw new Error('create_household_invitation returned no row');
    return invitation;
  });
}

const ownerId = '00000000-0000-4000-9000-000000000001';
const memberId = '00000000-0000-4000-9000-000000000002';
const unrelatedId = '00000000-0000-4000-9000-000000000003';

afterAll(async () => {
  await closeDatabase();
});

async function addActiveMember(
  spaceId: string,
  userId: string,
  role: 'owner' | 'member',
  email = `${userId}@budget.invalid`,
) {
  await ensureAuthUser(userId, email);
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

describe('household invitation creation', () => {
  it('allows only active household owners and rejects personal spaces without an event', async () => {
    await ensureAuthUser(ownerId, 'owner-create@budget.invalid');
    const owner = asUser(ownerId);
    const household = await owner.createSpace(`Invite ${randomUUID()}`, 'household');
    const personal = await owner.createSpace(`No invite ${randomUUID()}`, 'personal');
    await addActiveMember(household.id, memberId, 'member');

    await expect(
      createInvitation(memberId, household.id, randomUUID(), 'new-member@budget.invalid'),
    ).rejects.toMatchObject({ message: 'not_authorized' });
    await expect(
      createInvitation(unrelatedId, household.id, randomUUID(), 'new-member@budget.invalid'),
    ).rejects.toMatchObject({ message: 'not_authorized' });
    await expect(
      createInvitation(ownerId, personal.id, randomUUID(), 'new-member@budget.invalid'),
    ).rejects.toMatchObject({ message: 'personal_space_prohibited' });

    const events = await databaseQuery<{ count: string }>(
      `select count(*)::text as count
       from public.household_membership_events
       where space_id = $1`,
      [personal.id],
    );
    expect(events).toEqual([{ count: '0' }]);
  });

  it.each([
    '',
    '   ',
    'missing-at.example',
    'two@@example.test',
    'white space@example.test',
    `x@${'a'.repeat(253)}`,
  ])('rejects invalid transient email input without persisting it: %j', async (email) => {
    await ensureAuthUser(ownerId, 'owner-email-check@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Email ${randomUUID()}`, 'household');
    await expect(
      createInvitation(ownerId, household.id, randomUUID(), email),
    ).rejects.toMatchObject({ message: 'invalid_input' });
  });

  it('normalizes recipient identity, stores no plaintext/token, and fixes expiry at seven days', async () => {
    await ensureAuthUser(ownerId, 'owner-privacy@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Privacy ${randomUUID()}`, 'household');
    const requestId = randomUUID();
    const email = '  Invitee.Case@Example.Test  ';
    const created = await createInvitation(ownerId, household.id, requestId, email);

    expect(created.invitation_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await databaseQuery<Record<string, unknown>>(
      `select invitation.*,
              invitation.expires_at = invitation.created_at + interval '7 days' as exact_expiry,
              encode(invitation.token_digest, 'hex') as token_digest_hex
       from public.household_invitations as invitation
       where invitation.id = $1`,
      [created.invitation_id],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.exact_expiry).toBe(true);
    expect(JSON.stringify(stored).toLowerCase()).not.toContain('invitee.case@example.test');
    expect(JSON.stringify(stored)).not.toContain(created.invitation_token);

    const events = await databaseQuery<Record<string, unknown>>(
      `select * from public.household_membership_events
       where actor_user_id = $1 and request_id = $2`,
      [ownerId, requestId],
    );
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events).toLowerCase()).not.toContain('invitee.case@example.test');
    expect(JSON.stringify(events)).not.toContain(created.invitation_token);
  });

  it('rejects an active recipient and one unexpired pending invitation for normalized identity', async () => {
    await ensureAuthUser(ownerId, 'owner-duplicate@budget.invalid');
    await ensureAuthUser(memberId, 'active-member@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Duplicate ${randomUUID()}`, 'household');
    await addActiveMember(household.id, memberId, 'member', 'active-member@budget.invalid');

    await expect(
      createInvitation(ownerId, household.id, randomUUID(), 'ACTIVE-MEMBER@budget.invalid'),
    ).rejects.toMatchObject({ message: 'membership_already_active' });

    await createInvitation(ownerId, household.id, randomUUID(), 'pending@budget.invalid');
    await expect(
      createInvitation(ownerId, household.id, randomUUID(), ' Pending@Budget.Invalid '),
    ).rejects.toMatchObject({ message: 'invitation_already_pending' });
  });

  it('allows a replacement after fixed expiry and leaves the expired row unchanged', async () => {
    await ensureAuthUser(ownerId, 'owner-expiry@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Expired ${randomUUID()}`, 'household');
    const first = await createInvitation(
      ownerId,
      household.id,
      randomUUID(),
      'expired@budget.invalid',
    );
    await databaseQuery(
      `update public.household_invitations
       set created_at = created_at - interval '8 days',
           expires_at = expires_at - interval '8 days'
       where id = $1`,
      [first.invitation_id],
    );

    await expect(
      createInvitation(ownerId, household.id, randomUUID(), 'expired@budget.invalid'),
    ).resolves.toMatchObject({ invitation_id: expect.any(String) });
    const firstState = await databaseQuery<{ status: string }>(
      'select status::text from public.household_invitations where id = $1',
      [first.invitation_id],
    );
    expect(firstState).toEqual([{ status: 'pending' }]);
  });

  it('returns one deterministic result for exact replay and rejects changed input globally per actor', async () => {
    await ensureAuthUser(ownerId, 'owner-replay@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Replay ${randomUUID()}`, 'household');
    const otherHousehold = await asUser(ownerId).createSpace(
      `Replay other ${randomUUID()}`,
      'household',
    );
    const requestId = randomUUID();
    const input = [ownerId, household.id, requestId, 'replay@budget.invalid'] as const;
    const first = await createInvitation(...input);
    const replay = await createInvitation(...input);
    expect(replay).toEqual(first);

    await expect(
      createInvitation(ownerId, household.id, requestId, 'changed@budget.invalid'),
    ).rejects.toMatchObject({ message: 'idempotency_conflict' });
    await expect(
      createInvitation(ownerId, otherHousehold.id, requestId, 'replay@budget.invalid'),
    ).rejects.toMatchObject({ message: 'idempotency_conflict' });

    const counts = await databaseQuery<{ invitations: string; events: string }>(
      `select
         (select count(*)::text from public.household_invitations where id = $1) as invitations,
         (select count(*)::text from public.household_membership_events
          where actor_user_id = $2 and request_id = $3) as events`,
      [first.invitation_id, ownerId, requestId],
    );
    expect(counts).toEqual([{ invitations: '1', events: '1' }]);
  });

  it('serializes identical concurrent creation at the actor/request barrier', async () => {
    await ensureAuthUser(ownerId, 'owner-concurrent-create@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Concurrent ${randomUUID()}`, 'household');
    const requestId = randomUUID();
    const call = (client: PoolClient) =>
      client.query<CreatedInvitation>(
        'select * from public.create_household_invitation($1, $2, $3)',
        [household.id, requestId, 'race-same@budget.invalid'],
      ).then((result) => result.rows[0]!);
    const results = await runConcurrentUserActions([
      { userId: ownerId, action: call },
      { userId: ownerId, action: call },
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    if (results[0]?.status !== 'fulfilled' || results[1]?.status !== 'fulfilled') return;
    expect(results[0].value).toEqual(results[1].value);
    const counts = await databaseQuery<{ invitations: string; events: string }>(
      `select
         (select count(*)::text from public.household_invitations where id = $1) as invitations,
         (select count(*)::text from public.household_membership_events
          where actor_user_id = $2 and request_id = $3) as events`,
      [results[0].value.invitation_id, ownerId, requestId],
    );
    expect(counts).toEqual([{ invitations: '1', events: '1' }]);
  });

  it('serializes conflicting request reuse and duplicate-identity creation races', async () => {
    await ensureAuthUser(ownerId, 'owner-concurrent-conflict@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Conflict ${randomUUID()}`, 'household');
    const requestId = randomUUID();
    const requestRace = await runConcurrentUserActions([
      {
        userId: ownerId,
        action: async (client) =>
          client.query('select * from public.create_household_invitation($1, $2, $3)', [
            household.id,
            requestId,
            'race-a@budget.invalid',
          ]),
      },
      {
        userId: ownerId,
        action: async (client) =>
          client.query('select * from public.create_household_invitation($1, $2, $3)', [
            household.id,
            requestId,
            'race-b@budget.invalid',
          ]),
      },
    ]);
    expect(requestRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(requestRace.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      (requestRace.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ message: 'idempotency_conflict' });

    const identityRace = await runConcurrentUserActions([
      {
        userId: ownerId,
        action: async (client) =>
          client.query('select * from public.create_household_invitation($1, $2, $3)', [
            household.id,
            randomUUID(),
            'race-identity@budget.invalid',
          ]),
      },
      {
        userId: ownerId,
        action: async (client) =>
          client.query('select * from public.create_household_invitation($1, $2, $3)', [
            household.id,
            randomUUID(),
            'RACE-IDENTITY@budget.invalid',
          ]),
      },
    ]);
    expect(identityRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(identityRace.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      (identityRace.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ message: 'invitation_already_pending' });
  });
});

describe('household invitation acceptance and cancellation', () => {
  it('accepts for a confirmed matching account and appends one complete event', async () => {
    const inviteeId = randomUUID();
    const inviteeEmail = `accept-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-accept@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail);
    const household = await asUser(ownerId).createSpace(`Accept ${randomUUID()}`, 'household');
    const created = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    const requestId = randomUUID();

    await expect(acceptInvitation(inviteeId, requestId, created.invitation_token)).resolves.toEqual({
      space_id: household.id,
      membership_status: 'active',
      role: 'member',
    });

    const state = await databaseQuery<Record<string, unknown>>(
      `select invitation.status::text, invitation.accepted_by_user_id,
              membership.status::text as membership_status, membership.role::text,
              event.kind::text, event.subject_user_id, event.next_status::text,
              event.next_role::text
       from public.household_invitations as invitation
       join public.space_memberships as membership
         on membership.space_id = invitation.space_id
        and membership.user_id = invitation.accepted_by_user_id
       join public.household_membership_events as event
         on event.invitation_id = invitation.id and event.kind = 'invitation_accepted'
       where invitation.id = $1`,
      [created.invitation_id],
    );
    expect(state).toEqual([
      {
        status: 'accepted',
        accepted_by_user_id: inviteeId,
        membership_status: 'active',
        role: 'member',
        kind: 'invitation_accepted',
        subject_user_id: inviteeId,
        next_status: 'active',
        next_role: 'member',
      },
    ]);
  });

  it.each(['revoked', 'left'] as const)(
    'reactivates a %s membership as member only through a newly issued invitation',
    async (inactiveStatus) => {
      const inviteeId = randomUUID();
      const inviteeEmail = `reactivate-${inactiveStatus}-${randomUUID()}@budget.invalid`;
      await ensureAuthUser(ownerId, 'owner-reactivate@budget.invalid');
      const household = await asUser(ownerId).createSpace(
        `Reactivate ${inactiveStatus} ${randomUUID()}`,
        'household',
      );
      await addActiveMember(household.id, inviteeId, 'owner', inviteeEmail);
      await databaseQuery(
        `update public.space_memberships
         set status = $3::public.membership_status,
             ended_at = now(),
             ended_by_user_id = case when $3 = 'left' then $2 else $4 end
         where space_id = $1 and user_id = $2`,
        [household.id, inviteeId, inactiveStatus, ownerId],
      );
      const before = await databaseQuery<{ event_count: string }>(
        `select count(*)::text as event_count
         from public.household_membership_events
         where space_id = $1 and subject_user_id = $2`,
        [household.id, inviteeId],
      );

      const created = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
      await acceptInvitation(inviteeId, randomUUID(), created.invitation_token);

      const membership = await databaseQuery<Record<string, unknown>>(
        `select status::text, role::text, ended_at, ended_by_user_id,
                activated_at >= created_at as reactivated
         from public.space_memberships where space_id = $1 and user_id = $2`,
        [household.id, inviteeId],
      );
      expect(membership).toEqual([
        {
          status: 'active',
          role: 'member',
          ended_at: null,
          ended_by_user_id: null,
          reactivated: true,
        },
      ]);
      const after = await databaseQuery<{ event_count: string }>(
        `select count(*)::text as event_count
         from public.household_membership_events
         where space_id = $1 and subject_user_id = $2`,
        [household.id, inviteeId],
      );
      expect(Number(after[0]?.event_count)).toBe(Number(before[0]?.event_count) + 1);
    },
  );

  it('gives malformed, unknown, expired, cancelled, consumed, and wrong-account tokens one safe result', async () => {
    const inviteeId = randomUUID();
    const wrongId = randomUUID();
    const inviteeEmail = `safe-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-safe-errors@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail);
    await ensureAuthUser(wrongId, `wrong-${randomUUID()}@budget.invalid`);
    const household = await asUser(ownerId).createSpace(`Safe ${randomUUID()}`, 'household');

    const expired = await createInvitation(ownerId, household.id, randomUUID(), `expired-${randomUUID()}@budget.invalid`);
    await databaseQuery(
      `update public.household_invitations
       set created_at = created_at - interval '8 days', expires_at = expires_at - interval '8 days'
       where id = $1`,
      [expired.invitation_id],
    );
    const cancelled = await createInvitation(ownerId, household.id, randomUUID(), `cancel-${randomUUID()}@budget.invalid`);
    await cancelInvitation(ownerId, household.id, randomUUID(), cancelled.invitation_id);
    const consumed = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    await acceptInvitation(inviteeId, randomUUID(), consumed.invitation_token);
    const wrong = await createInvitation(ownerId, household.id, randomUUID(), `other-${randomUUID()}@budget.invalid`);

    const unsafeTokens = [
      'not-a-token',
      'A'.repeat(43),
      expired.invitation_token,
      cancelled.invitation_token,
      consumed.invitation_token,
    ];
    const failures = await Promise.all(
      unsafeTokens.map(async (token) => {
        try {
          await acceptInvitation(inviteeId, randomUUID(), token);
          return 'unexpected-success';
        } catch (error) {
          return (error as Error).message;
        }
      }),
    );
    try {
      await acceptInvitation(wrongId, randomUUID(), wrong.invitation_token);
      failures.push('unexpected-success');
    } catch (error) {
      failures.push((error as Error).message);
    }
    expect(failures).toEqual(Array(6).fill('invitation_unavailable'));
  });

  it('rejects anonymous and unconfirmed acceptance without exposing invitation state', async () => {
    const inviteeId = randomUUID();
    const inviteeEmail = `unconfirmed-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-unconfirmed@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail, false);
    const household = await asUser(ownerId).createSpace(`Unconfirmed ${randomUUID()}`, 'household');
    const created = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);

    await expect(
      acceptInvitation(inviteeId, randomUUID(), created.invitation_token),
    ).rejects.toMatchObject({ message: 'not_authenticated' });
    await expect(
      withAnonymousSession((client) =>
        client.query('select * from public.accept_household_invitation($1, $2)', [
          randomUUID(),
          created.invitation_token,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('replays acceptance without reactivation and rejects the token under another request', async () => {
    const inviteeId = randomUUID();
    const inviteeEmail = `accept-replay-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-accept-replay@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail);
    const household = await asUser(ownerId).createSpace(`Accept replay ${randomUUID()}`, 'household');
    const created = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    const requestId = randomUUID();
    const first = await acceptInvitation(inviteeId, requestId, created.invitation_token);
    await databaseQuery(
      `update public.space_memberships
       set status = 'revoked', ended_at = now(), ended_by_user_id = $3
       where space_id = $1 and user_id = $2`,
      [household.id, inviteeId, ownerId],
    );

    await expect(acceptInvitation(inviteeId, requestId, created.invitation_token)).resolves.toEqual(first);
    await expect(
      acceptInvitation(inviteeId, randomUUID(), created.invitation_token),
    ).rejects.toMatchObject({ message: 'invitation_unavailable' });
    const membership = await databaseQuery<{ status: string }>(
      'select status::text from public.space_memberships where space_id = $1 and user_id = $2',
      [household.id, inviteeId],
    );
    expect(membership).toEqual([{ status: 'revoked' }]);
  });

  it('cancels pending or expired invitations idempotently but never an accepted invitation', async () => {
    const inviteeId = randomUUID();
    const inviteeEmail = `cancel-state-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-cancel@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail);
    const household = await asUser(ownerId).createSpace(`Cancel ${randomUUID()}`, 'household');
    const pending = await createInvitation(ownerId, household.id, randomUUID(), `pending-${randomUUID()}@budget.invalid`);
    const cancelRequest = randomUUID();
    const first = await cancelInvitation(ownerId, household.id, cancelRequest, pending.invitation_id);
    await expect(
      cancelInvitation(ownerId, household.id, cancelRequest, pending.invitation_id),
    ).resolves.toEqual(first);

    const expired = await createInvitation(ownerId, household.id, randomUUID(), `expired-cancel-${randomUUID()}@budget.invalid`);
    await databaseQuery(
      `update public.household_invitations
       set created_at = created_at - interval '8 days', expires_at = expires_at - interval '8 days'
       where id = $1`,
      [expired.invitation_id],
    );
    await expect(
      cancelInvitation(ownerId, household.id, randomUUID(), expired.invitation_id),
    ).resolves.toMatchObject({ status: 'cancelled' });

    const accepted = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    await acceptInvitation(inviteeId, randomUUID(), accepted.invitation_token);
    await expect(
      cancelInvitation(ownerId, household.id, randomUUID(), accepted.invitation_id),
    ).rejects.toMatchObject({ message: 'invitation_unavailable' });
    const membership = await databaseQuery<{ status: string }>(
      'select status::text from public.space_memberships where space_id = $1 and user_id = $2',
      [household.id, inviteeId],
    );
    expect(membership).toEqual([{ status: 'active' }]);
  });

  it('rolls back invitation, membership, and terminal state when the audit insert is denied', async () => {
    const inviteeId = randomUUID();
    const inviteeEmail = `atomic-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-atomic@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail);
    const household = await asUser(ownerId).createSpace(`Atomic ${randomUUID()}`, 'household');
    const created = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    await databaseQuery(
      'revoke insert on public.household_membership_events from household_command_owner',
    );
    try {
      await expect(
        acceptInvitation(inviteeId, randomUUID(), created.invitation_token),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await databaseQuery(
        'grant insert on public.household_membership_events to household_command_owner',
      );
    }
    const state = await databaseQuery<{ invitation_status: string; membership_count: string }>(
      `select invitation.status::text as invitation_status,
              (select count(*)::text from public.space_memberships
               where space_id = invitation.space_id and user_id = $2) as membership_count
       from public.household_invitations as invitation where invitation.id = $1`,
      [created.invitation_id, inviteeId],
    );
    expect(state).toEqual([{ invitation_status: 'pending', membership_count: '0' }]);
  });

  it('serializes identical and conflicting acceptance races on independent sessions', async () => {
    const inviteeId = randomUUID();
    const inviteeEmail = `accept-race-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-accept-race@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail);
    const household = await asUser(ownerId).createSpace(`Accept race ${randomUUID()}`, 'household');
    const same = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    const sameRequest = randomUUID();
    const identical = await runConcurrentUserActions([
      {
        userId: inviteeId,
        action: async (client) =>
          (await client.query<AcceptedInvitation>(
            'select * from public.accept_household_invitation($1, $2)',
            [sameRequest, same.invitation_token],
          )).rows[0]!,
      },
      {
        userId: inviteeId,
        action: async (client) =>
          (await client.query<AcceptedInvitation>(
            'select * from public.accept_household_invitation($1, $2)',
            [sameRequest, same.invitation_token],
          )).rows[0]!,
      },
    ]);
    expect(
      identical
        .filter((result) => result.status === 'rejected')
        .map((result) => (result as PromiseRejectedResult).reason),
    ).toEqual([]);
    expect(identical.filter((result) => result.status === 'fulfilled')).toHaveLength(2);

    await databaseQuery(
      `update public.space_memberships set status = 'revoked', ended_at = now(), ended_by_user_id = $3
       where space_id = $1 and user_id = $2`,
      [household.id, inviteeId, ownerId],
    );
    const different = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    const conflict = await runConcurrentUserActions([
      {
        userId: inviteeId,
        action: async (client) => client.query(
          'select * from public.accept_household_invitation($1, $2)',
          [randomUUID(), different.invitation_token],
        ),
      },
      {
        userId: inviteeId,
        action: async (client) => client.query(
          'select * from public.accept_household_invitation($1, $2)',
          [randomUUID(), different.invitation_token],
        ),
      },
    ]);
    expect(conflict.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(conflict.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((conflict.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ message: 'invitation_unavailable' });
  });

  it('linearizes acceptance racing cancellation to one terminal state', async () => {
    const inviteeId = randomUUID();
    const inviteeEmail = `terminal-race-${randomUUID()}@budget.invalid`;
    await ensureAuthUser(ownerId, 'owner-terminal-race@budget.invalid');
    await ensureAuthUser(inviteeId, inviteeEmail);
    const household = await asUser(ownerId).createSpace(`Terminal race ${randomUUID()}`, 'household');
    const created = await createInvitation(ownerId, household.id, randomUUID(), inviteeEmail);
    const race = await runConcurrentUserActions([
      {
        userId: inviteeId,
        action: async (client) => client.query(
          'select * from public.accept_household_invitation($1, $2)',
          [randomUUID(), created.invitation_token],
        ),
      },
      {
        userId: ownerId,
        action: async (client) => client.query(
          'select * from public.cancel_household_invitation($1, $2, $3)',
          [household.id, randomUUID(), created.invitation_id],
        ),
      },
    ]);
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const final = await databaseQuery<{ status: string; memberships: string; terminal_events: string }>(
      `select invitation.status::text,
              (select count(*)::text from public.space_memberships
               where space_id = invitation.space_id and user_id = $2 and status = 'active') as memberships,
              (select count(*)::text from public.household_membership_events
               where invitation_id = invitation.id
                 and kind in ('invitation_accepted', 'invitation_cancelled')) as terminal_events
       from public.household_invitations as invitation where invitation.id = $1`,
      [created.invitation_id, inviteeId],
    );
    expect(final[0]?.terminal_events).toBe('1');
    expect(final[0]?.memberships).toBe(final[0]?.status === 'accepted' ? '1' : '0');
  });
});
