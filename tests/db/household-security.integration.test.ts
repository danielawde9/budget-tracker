import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';

import {
  asUser,
  closeDatabase,
  databaseQuery,
  ensureAuthUser,
  withAdminTransaction,
  withServiceRoleSession,
  withUserSession,
} from './test-database.js';

const ownerId = '00000000-0000-4000-a000-000000000001';

afterAll(async () => {
  await closeDatabase();
});

async function addMember(
  spaceId: string,
  userId: string,
  status: 'active' | 'revoked' | 'left',
) {
  const email = `${status}-${userId}@budget.invalid`;
  await ensureAuthUser(userId, email);
  await databaseQuery(
    `insert into public.space_memberships (
       space_id, user_id, role, status, created_at, activated_at, ended_at, ended_by_user_id
     ) values (
       $1::uuid, $2::uuid, 'member', $3::public.membership_status,
       now() - interval '2 days', now() - interval '2 days',
       case when $3::public.membership_status = 'active' then null else now() - interval '1 day' end,
       case
         when $3::public.membership_status = 'active' then null
         when $3::public.membership_status = 'left' then $2::uuid
         else $4::uuid
       end
     )`,
    [spaceId, userId, status, ownerId],
  );
  return email;
}

async function createInvitation(spaceId: string, email: string) {
  const requestId = randomUUID();
  return withUserSession(ownerId, async (client) => {
    const result = await client.query<{
      invitation_id: string;
      invitation_token: string;
      expires_at: Date;
    }>('select * from public.create_household_invitation($1, $2, $3)', [
      spaceId,
      requestId,
      email,
    ]);
    return result.rows[0]!;
  });
}

async function expectEventAppendDenial(
  actorId: string,
  action: (client: PoolClient) => Promise<unknown>,
) {
  await expect(
    withAdminTransaction(async (client) => {
      await client.query(
        'revoke insert on public.household_membership_events from household_command_owner',
      );
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actorId]);
      await client.query('set local role authenticated');
      return action(client);
    }),
  ).rejects.toMatchObject({ code: '42501' });
}

describe('household defense in depth', () => {
  it.each(['revoked', 'left'] as const)(
    'denies every existing financial command after a membership becomes %s',
    async (status) => {
      const userId = randomUUID();
      await ensureAuthUser(ownerId, 'owner-financial-ratchet@budget.invalid');
      const owner = asUser(ownerId);
      const household = await owner.createSpace(`Financial ratchet ${randomUUID()}`, 'household');
      const wallet = await owner.createWallet(household.id, 'Owner USD', 'USD');
      const event = await owner.recordEvent({
        spaceId: household.id,
        requestId: randomUUID(),
        kind: 'income',
        effectiveDate: '2026-09-08',
        movements: [{ walletId: wallet.id, amountMinor: '10000' }],
      });
      const loan = await owner.openLoanOutstanding({
        spaceId: household.id,
        requestId: randomUUID(),
        direction: 'i_owe_them',
        personName: 'Boundary lender',
        currency: 'USD',
        amountMinor: '5000',
        effectiveDate: '2026-09-08',
      });
      await addMember(household.id, userId, status);
      const inactive = asUser(userId);
      const calls = [
        () => inactive.createWallet(household.id, 'Denied wallet', 'USD'),
        () => inactive.recordEvent({
          spaceId: household.id,
          requestId: randomUUID(),
          kind: 'expense',
          effectiveDate: '2026-09-08',
          movements: [{ walletId: wallet.id, amountMinor: '-1' }],
        }),
        () => inactive.openLoanOutstanding({
          spaceId: household.id,
          requestId: randomUUID(),
          direction: 'they_owe_me',
          personName: 'Denied opening',
          currency: 'USD',
          amountMinor: '1',
          effectiveDate: '2026-09-08',
        }),
        () => inactive.recordCashLoan({
          spaceId: household.id,
          requestId: randomUUID(),
          direction: 'they_owe_me',
          personName: 'Denied cash loan',
          currency: 'USD',
          walletId: wallet.id,
          amountMinor: '1',
          effectiveDate: '2026-09-08',
        }),
        () => inactive.repayLoan({
          spaceId: household.id,
          requestId: randomUUID(),
          loanId: loan.loan_id,
          walletId: wallet.id,
          amountMinor: '1',
          effectiveDate: '2026-09-08',
        }),
        () => inactive.reverseEvent(
          household.id,
          randomUUID(),
          event.id,
          '2026-09-08',
        ),
        () => inactive.setLoanMonthlyTarget({
          spaceId: household.id,
          requestId: randomUUID(),
          loanId: loan.loan_id,
          month: '2026-09-01',
          targetMinor: '100',
        }),
      ];

      for (const call of calls) {
        await expect(call()).rejects.toMatchObject({
          code: '42501',
          message: 'an active space membership is required',
        });
      }
    },
  );

  it('rejects every invalid personal-space membership shape at deferred commit', async () => {
    await ensureAuthUser(ownerId, 'owner-personal-invariants@budget.invalid');
    const personal = await asUser(ownerId).createSpace(`Personal invariants ${randomUUID()}`, 'personal');

    await expect(
      withAdminTransaction((client) =>
        client.query(
          `update public.space_memberships set role = 'member'
           where space_id = $1 and user_id = $2`,
          [personal.id, ownerId],
        ),
      ),
    ).rejects.toMatchObject({ message: 'personal space membership invariant violated' });
    await expect(
      withAdminTransaction((client) =>
        client.query(
          `update public.space_memberships
           set status = 'left', ended_at = now(), ended_by_user_id = user_id
           where space_id = $1 and user_id = $2`,
          [personal.id, ownerId],
        ),
      ),
    ).rejects.toMatchObject({ message: 'personal space membership invariant violated' });
  });

  it('keeps RLS and deferred invariants effective after deliberate membership grants', async () => {
    const attackerId = randomUUID();
    await ensureAuthUser(ownerId, 'owner-membership-defense@budget.invalid');
    await ensureAuthUser(attackerId, `attacker-${randomUUID()}@budget.invalid`);
    const household = await asUser(ownerId).createSpace(`Membership defense ${randomUUID()}`, 'household');
    await databaseQuery('grant update on public.space_memberships to authenticated');
    try {
      const hidden = await withUserSession(attackerId, (client) =>
        client.query(
          `update public.space_memberships set role = 'member'
           where space_id = $1 and user_id = $2`,
          [household.id, ownerId],
        ),
      );
      expect(hidden.rowCount).toBe(0);

      await databaseQuery(
        `create policy memberships_test_permissive_update on public.space_memberships
         for update to authenticated using (true) with check (true)`,
      );
      await databaseQuery(
        `create policy memberships_test_permissive_select on public.space_memberships
         for select to authenticated using (true)`,
      );
      await expect(
        withUserSession(attackerId, (client) =>
          client.query(
            `update public.space_memberships set role = 'member'
             where space_id = $1 and user_id = $2`,
            [household.id, ownerId],
          ),
        ),
      ).rejects.toMatchObject({ message: 'household must retain an active owner' });
    } finally {
      await databaseQuery(
        'drop policy if exists memberships_test_permissive_select on public.space_memberships',
      );
      await databaseQuery(
        'drop policy if exists memberships_test_permissive_update on public.space_memberships',
      );
      await databaseQuery('revoke update on public.space_memberships from authenticated');
    }
  });

  it('rolls back creation, cancellation, and role changes when event append is denied', async () => {
    const memberId = randomUUID();
    await ensureAuthUser(ownerId, 'owner-atomic-commands@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Atomic commands ${randomUUID()}`, 'household');
    await addMember(household.id, memberId, 'active');
    const pending = await createInvitation(household.id, `cancel-atomic-${randomUUID()}@budget.invalid`);
    const before = await databaseQuery<{ invitations: string; events: string }>(
      `select
         (select count(*)::text from public.household_invitations where space_id = $1) as invitations,
         (select count(*)::text from public.household_membership_events where space_id = $1) as events`,
      [household.id],
    );
    await expectEventAppendDenial(ownerId, (client) =>
      client.query('select * from public.create_household_invitation($1, $2, $3)', [
        household.id,
        randomUUID(),
        `create-atomic-${randomUUID()}@budget.invalid`,
      ]),
    );
    await expectEventAppendDenial(ownerId, (client) =>
      client.query('select * from public.cancel_household_invitation($1, $2, $3)', [
        household.id,
        randomUUID(),
        pending.invitation_id,
      ]),
    );
    await expectEventAppendDenial(ownerId, (client) =>
      client.query(
        'select * from public.set_household_member_role($1, $2, $3, $4::public.member_role)',
        [household.id, randomUUID(), memberId, 'owner'],
      ),
    );
    const after = await databaseQuery<{ invitations: string; events: string; pending_status: string; role: string }>(
      `select
         (select count(*)::text from public.household_invitations where space_id = $1) as invitations,
         (select count(*)::text from public.household_membership_events where space_id = $1) as events,
         (select status::text from public.household_invitations where id = $2) as pending_status,
         (select role::text from public.space_memberships where space_id = $1 and user_id = $3) as role`,
      [household.id, pending.invitation_id, memberId],
    );
    expect(after).toEqual([{ ...before[0], pending_status: 'pending', role: 'member' }]);
  });

  it('keeps application and background roles out of household tables and private helpers', async () => {
    await ensureAuthUser(ownerId, 'owner-direct-writes@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Direct writes ${randomUUID()}`, 'household');

    await expect(
      withUserSession(ownerId, (client) =>
        client.query(
          `insert into public.household_membership_events (
             space_id, actor_user_id, request_id, request_fingerprint, kind
           ) values ($1, $2, $3, decode(repeat('11',32),'hex'), 'invitation_created')`,
          [household.id, ownerId, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withServiceRoleSession((client) =>
        client.query(
          `insert into public.space_memberships (space_id, user_id, role)
           values ($1, $2, 'member')`,
          [household.id, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const privateExposure = await databaseQuery<{ exposed: string }>(
      `select count(*)::text as exposed
       from pg_proc as procedure
       join pg_namespace as namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'private'
         and (procedure.proname like 'household_%' or procedure.proname = 'is_active_owner')
         and (has_function_privilege('authenticated', procedure.oid, 'execute')
           or has_function_privilege('anon', procedure.oid, 'execute')
           or has_function_privilege('service_role', procedure.oid, 'execute'))`,
    );
    expect(privateExposure).toEqual([{ exposed: '0' }]);
  });

  it('has exact command owners, execute grants, and no login inheriting the owner role', async () => {
    const signatures = [
      'public.accept_household_invitation(uuid,text)',
      'public.cancel_household_invitation(uuid,uuid,uuid)',
      'public.create_household_invitation(uuid,uuid,text)',
      'public.leave_household_space(uuid,uuid)',
      'public.list_household_invitations(uuid,integer,timestamp with time zone,uuid)',
      'public.list_household_members(uuid,integer,uuid)',
      'public.remove_household_member(uuid,uuid,uuid)',
      'public.set_household_member_role(uuid,uuid,uuid,public.member_role)',
    ];
    const rows = await databaseQuery<{
      signature: string;
      owner: string;
      authenticated: boolean;
      anonymous: boolean;
      background: boolean;
    }>(
      `select procedure.oid::regprocedure::text as signature,
              owner.rolname as owner,
              has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated,
              has_function_privilege('anon', procedure.oid, 'execute') as anonymous,
              has_function_privilege('service_role', procedure.oid, 'execute') as background
       from pg_proc as procedure
       join pg_namespace as namespace on namespace.oid = procedure.pronamespace
       join pg_roles as owner on owner.oid = procedure.proowner
       where namespace.nspname = 'public'
         and procedure.oid = any($1::regprocedure[])
       order by procedure.oid::regprocedure::text`,
      [signatures],
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.owner === 'household_command_owner')).toBe(true);
    expect(rows.every((row) => row.authenticated && !row.anonymous && !row.background)).toBe(true);

    const roleLeaks = await databaseQuery<{ count: string }>(
      `select count(*)::text as count
       from pg_auth_members as membership
       join pg_roles as granted_role on granted_role.oid = membership.roleid
       join pg_roles as recipient on recipient.oid = membership.member
       where granted_role.rolname = 'household_command_owner'
         and recipient.rolcanlogin
         and (membership.inherit_option or membership.set_option)`,
    );
    expect(roleLeaks).toEqual([{ count: '0' }]);
    const ownerCapabilities = await databaseQuery<Record<string, boolean>>(
      `select
         has_schema_privilege('household_command_owner', 'public', 'create') as creates_public,
         has_schema_privilege('household_command_owner', 'auth', 'usage') as uses_auth,
         has_table_privilege('household_command_owner', 'private.household_invitation_keys', 'select') as reads_keys,
         has_table_privilege('authenticated', 'public.household_invitations', 'select') as client_reads_invitations,
         has_table_privilege('service_role', 'public.household_membership_events', 'select') as background_reads_events`,
    );
    expect(ownerCapabilities).toEqual([{
      creates_public: false,
      uses_auth: false,
      reads_keys: false,
      client_reads_invitations: false,
      background_reads_events: false,
    }]);
  });

  it('stores no sensitive identity/token columns and browser source has no direct write or logging path', async () => {
    const bannedColumns = await databaseQuery<{ count: string }>(
      `select count(*)::text as count
       from information_schema.columns
       where table_schema in ('public', 'private')
         and table_name in ('household_invitations', 'household_membership_events')
         and column_name = any($1::text[])`,
      [[
        'email', 'normalized_email', 'invitation_token', 'raw_token', 'message',
        'provider_response', 'display_name', 'ip_address', 'user_agent',
      ]],
    );
    expect(bannedColumns).toEqual([{ count: '0' }]);

    const sourceFiles = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
    const source = sourceFiles
      .map((file) => readFileSync(join('src', file), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /from\(['"](?:space_memberships|household_invitations|household_membership_events)['"]\)[\s\S]{0,200}\.(?:insert|update|delete|upsert|truncate)\(/,
    );
    expect(source).not.toMatch(/console\.(?:log|info|debug)\([^\n]*(?:invitation_token|access_token|refresh_token)/i);
  });

  it('paginates invitation projections without overlap or omission', async () => {
    await ensureAuthUser(ownerId, 'owner-invitation-pages@budget.invalid');
    const household = await asUser(ownerId).createSpace(`Invitation pages ${randomUUID()}`, 'household');
    for (let index = 0; index < 5; index += 1) {
      await createInvitation(household.id, `page-${index}-${randomUUID()}@budget.invalid`);
    }
    const first = await withUserSession(ownerId, (client) =>
      client.query<{ invitation_id: string; created_at: Date }>(
        'select * from public.list_household_invitations($1, 2, null, null)',
        [household.id],
      ),
    );
    const cursor = first.rows.at(-1)!;
    const second = await withUserSession(ownerId, (client) =>
      client.query<{ invitation_id: string; created_at: Date }>(
        'select * from public.list_household_invitations($1, 3, $2, $3)',
        [household.id, cursor.created_at, cursor.invitation_id],
      ),
    );
    const ids = [...first.rows, ...second.rows].map(({ invitation_id }) => invitation_id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});
