# Exact test recipes and verification commands

Shared by task files; not a claim any proposed SQL has passed. All paths below
are relative to `/Users/daniel/Desktop/Daniel/budget-tracking` or its isolated
implementation worktree. Do not create a second test framework.

## Disposable real-PostgreSQL setup

New tests should use the existing `tests/db/disposable-database.ts`. Its actual
exports inspected at `3a391ee` include `createDisposableDatabase`,
`bootstrapCompatibilityObjects`, `migrationFiles`, `replayMigrations`,
`withAuthenticatedTransaction`, `withRollback`, `expectSavepointRejection`,
`orderedAuthenticatedRace`, and `disposeDisposableDatabase`.

Copy this complete setup into the selected integration file, then append that
file's concrete tests. Replace only the task-specific database prefix/name in
the header; the prefix must match `budget_[a-z]{1,24}`.

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCompatibilityObjects, createDisposableDatabase,
  disposeDisposableDatabase, migrationFiles, replayMigrations,
  withAuthenticatedTransaction, expectSavepointRejection,
  orderedAuthenticatedRace, type DisposableDatabase,
} from './disposable-database.js';

let database: DisposableDatabase | undefined;
const actor = randomUUID();
const outsider = randomUUID();
let spaceId: string;

function db(): DisposableDatabase {
  if (!database) throw new Error('Disposable database was not initialized.');
  return database;
}

beforeAll(async () => {
  database = await createDisposableDatabase('budget_planning');
  await bootstrapCompatibilityObjects(db().client);
  await replayMigrations(db().client, migrationFiles());
  await db().client.query(
    `insert into auth.users(id, email, email_confirmed_at)
     values ($1, 'owner@budget.invalid', now()),
            ($2, 'outsider@budget.invalid', now())`, [actor, outsider],
  );
  spaceId = await withAuthenticatedTransaction(db().client, actor, async () => {
    const result = await db().client.query<{ id: string }>(
      "select id from public.create_space($1, 'personal') limit 2", ['Planning fixture'],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  });
}, 120_000);

afterAll(async () => {
  if (database) await disposeDisposableDatabase(database);
}, 30_000);
```

This harness bootstrap is intentionally a compatibility fixture. Also run the
repo's required actual Supabase/role tests; fixture auth alone is not hosted
PostgREST proof. Two race calls must use independent clients, never `Promise.all`
on a single pg client.

## Red/green step mechanics

1. Add the selected file's cases while its implementation is absent.
2. Run its exact focused command. Observe missing RPC/relation or wrong result
   as the expected red cause; a connection failure is not an adequate red test.
3. Write only the task's forward migration or application files.
4. Run focused command again. Once green, run that layer's full completion gate.
5. Stage only owned paths plus decisions/evidence and commit the named green step.

For a deferred constraint assertion, run `SET CONSTRAINTS ALL IMMEDIATE` inside
the rejection savepoint before asserting the exception. Merely resolving the
INSERT promise does not prove the deferred constraint allowed the transaction.

## Digest comparison: planned actions must not move money

Use this query immediately before and after each new non-posting command with
the fixture space UUID. Its arrays are bounded to ≤100 synthetic rows per table;
large production data is never loaded through this test digest.

```sql
select 'events' as relation_name, count(*)::text as row_count,
  md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as digest
from (select * from public.financial_events where space_id = $1 order by id limit 101) x
union all
select 'movements', count(*)::text,
  md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), ''))
from (select * from public.wallet_movements where space_id = $1 order by id limit 101) x
union all
select 'loans', count(*)::text,
  md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.event_id), ''))
from (select * from public.loan_postings where space_id = $1 order by event_id limit 101) x
order by relation_name;
```

Assert no count exceeds 100, then equality of all three rows before/after.
MD5 is a regression checksum here, not an authentication or security primitive.

## Privilege/trigger probes

For each new relation listed in its task, verify `relrowsecurity` and
`has_table_privilege(role, relation, 'INSERT,UPDATE,DELETE,TRUNCATE') = false`
for authenticated/service_role/anon. Check PUBLIC via ACL expansion, not by
passing PUBLIC as a login role. PUBLIC is an ACL pseudo-grantee with grantee 0.

For each public RPC, compare effective EXECUTE across all real roles and inspect
`aclexplode(coalesce(proacl,acldefault('f',proowner)))` for PUBLIC. Then test:

1. With ordinary authenticated role, direct INSERT and UPDATE fail.
2. In a rollback transaction, grant INSERT and sequence USAGE, retain RLS → deny.
3. In a separate rollback transaction, add a permissive RLS INSERT policy with
   the grant → owner-only INSERT trigger still denies.
4. As admin, malformed references/shapes violate CHECK/FK/deferred constraints.
5. Grant DELETE/TRUNCATE in a rollback transaction → even zero-row DELETE and
   whole-table TRUNCATE hit statement guards.
6. Roll back and verify grants/policies are restored before the next test.

Every SQL command remains parameterized. Relation names used for the enumerated
catalog/probe tests come from a fixed test allowlist, never user input.

## Migration replay and upgrade

Use `migrationFiles()` and freeze the selected predecessor version in the task's
test. Replay complete journal into empty fixture A. In fixture B replay only
the predecessor prefix, seed owner/wallet/category/loan/signed-reversal data
through the existing commands, record ≤100-row digests, then replay the suffix.
Verify the same prior rows and command outcomes, plus all new constraints.
Do not filter out later migrations to make an old milestone appear green.

The current harness bounds a journal at 100 files. Before approaching that
limit, make a separately measured ops/test-bound change; never silently drop
migrations from the replay set. Applied files are never edited or consolidated.

## Commands

Each DB file supplies the focused filename. The standard invocation is:

```bash
pnpm install --frozen-lockfile
bash -c 'set -euo pipefail; set -a; source ./.env.test; set +a; pnpm exec vitest run tests/db/planning-command-foundation.integration.test.ts --pool=forks --no-file-parallelism'
```

Use the authoritative ignored `.env.test` after verifying dedicated Budget DB
identity without printing credentials. Follow `docs/operations/ubuntu-development-stack.md`
and the existing Docker bridge for the suites that need it. No production or
Sandooq database is an acceptable substitute.

DB completion:

```bash
bash -c 'set -euo pipefail; set -a; source ./.env.test; set +a; pnpm check'
git diff --check
```

Gateway completion:

```bash
pnpm typecheck
pnpm test:ui
pnpm build
git diff --check
```

UI completion adds the file's focused Playwright scenario and `pnpm test:e2e`.
UI fixtures prove behavior in that fixture environment. Explicitly requested
authenticated UAT, live migrations and deployment have separate evidence.
