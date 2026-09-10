# Subcategories Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe one-level subcategory capability to Categories v1 without changing immutable financial history, introducing recursive hierarchy, implementing UI, or touching production.

**Architecture:** One forward-only migration adds an immutable nullable self-reference to `public.categories`, a protected request-idempotent `create_subcategory` command, and archive serialization that prevents active children beneath archived roots. A disposable PostgreSQL harness replays the full journal for behavior and seeded-upgrade proof; existing category, wallet, loan, UI, deployment, and live-release boundaries remain unchanged.

**Tech Stack:** PostgreSQL 17, Supabase Auth/RLS roles, PL/pgSQL, pgcrypto, TypeScript 7.0.2 strict, node-postgres 8.23.0, Vitest 5.0.0, pnpm 11.17.0.

---

**Spec:** `docs/superpowers/specs/2026-09-10-subcategories-database-foundation-design.md`

## Scope guard

- Do not edit any migration already present at baseline commit `554d61f`.
- Do not change `financial_events`, `wallet_movements`, `financial_event_categories`, loans, balances, or any financial command signature.
- Do not add UI, gateway, report, budget, seed-pack, rename, unarchive, reparent, or recursive-tree behavior.
- Do not update `ops/budget-migrations.sha256`, `LIVE_MANIFEST_SOURCE_SHA`, or the live runner's 18-version allowlist; those are release artifacts requiring a separate approval.
- Do not apply a migration or bootstrap data to hosted Supabase.
- Do not insert the 22 requested Essentials children during this implementation. Preserve the reviewed list for the later exact-target production operation.
- Every database behavior must be proven on PostgreSQL before a green commit.

## File map

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260910100000_subcategories_foundation.sql` | Nullable immutable parent, composite integrity, supporting indexes, parent validation, protected child creation, archive serialization, and exact grants. |
| `tests/db/subcategories.integration.test.ts` | Disposable real-Postgres behavior, rejection, replay, concurrency, authorization, history compatibility, catalog, and seeded 18-to-19 upgrade proof. |
| `tests/db/subcategories-source-ratchet.test.ts` | Static bounded-depth and exact-writer ratchet independent of database state. |
| `tests/ops/live-migrations.test.ts` | Exercise the frozen approved 18-migration release from an isolated `main` checkout even while the feature journal advances. |
| `docs/financial-command-inventory.md` | Classify `create_subcategory` as non-posting metadata and record unchanged financial writer boundaries. |
| `docs/decisions.md` | Already records the approved one-level model and account-specific Essentials bootstrap. No further entry is required unless implementation deviates. |

## Required test-harness interfaces

Keep the disposable harness local to `tests/db/subcategories.integration.test.ts` so the existing shared database pool and its 59 tests remain untouched.

```ts
interface MigrationFile {
  name: string;
  path: string;
  version: string;
}

interface CategoryRow {
  id: string;
  space_id: string;
  kind: 'income' | 'expense';
  name_en: string | null;
  name_ar: string | null;
  parent_category_id: string | null;
  archived_at: Date | null;
}

interface DisposableDatabase {
  admin: Client;
  client: Client;
  name: string;
  url: string;
}

type CategoryCommand = Readonly<{
  spaceId: string;
  requestId: string;
  parentCategoryId: string;
  nameEn: string | null;
  nameAr: string | null;
}>;
```

The harness must:

- derive its server only from `BUDGET_TEST_DATABASE_URL`;
- generate names matching `^budget_subcategories_[0-9a-f]{12}$`;
- create with `template0`, connect with a 10-second timeout, and bootstrap only `auth`, `extensions`, and `supabase_migrations` objects required by the journal;
- enumerate between 1 and 100 migration files matching `^\d{14}_[a-z0-9_]+\.sql$` in bytewise filename order;
- apply each migration and journal row in its own explicit transaction;
- set `request.jwt.claim.sub` and `role authenticated` only inside a transaction for user commands;
- cap concurrency helpers at two participants for this milestone; and
- close the child connection, verify current-role ownership, terminate at most 20 current-role sessions for the exact disposable name if required, drop that exact database, and close the admin connection in `finally`.

### Task 1: Keep the frozen live-runner tests independent of feature migrations

**Files:**
- Modify: `tests/ops/live-migrations.test.ts`

- [ ] **Step 1: Write the failing release-fixture assertion**

Add `const liveRunnerCommit = 'b5042865dd88fb4409894e39127b080f766c82df'` and require each behavioral fixture to return a script path below its private fixture directory rather than the active feature checkout:

```ts
const { base, env, script: fixtureScript } = fixture();
expect(fixtureScript.startsWith(`${base}/`)).toBe(true);
expect(realpathSync(fixtureScript)).not.toBe(realpathSync(script));
expect(run(fixtureScript, env, `APPLY LIVE MIGRATIONS TO ${projectRef}`).status).toBe(0);
```

Run the focused ops test. Expected: RED because the current helper still executes the active worktree script.

- [ ] **Step 2: Replace the bare Git simulation with an independent frozen checkout**

Inside `fixture`, clone the current repository into `join(base, 'release')`, then checkout the exact runner commit on an independent `main` branch:

```ts
const releaseRoot = join(base, 'release');
const clone = spawnSync(
  'git',
  ['clone', '--quiet', '--no-hardlinks', process.cwd(), releaseRoot],
  { encoding: 'utf8' },
);
if (clone.status !== 0) throw new Error('failed to create the live-release fixture');
const checkout = spawnSync(
  'git',
  ['-C', releaseRoot, 'checkout', '--quiet', '-B', 'main', liveRunnerCommit],
  { encoding: 'utf8' },
);
if (checkout.status !== 0) throw new Error('failed to checkout the live-release fixture');
```

Return `script: join(releaseRoot, 'scripts/ops/apply-live-migrations.sh')`. Change `run` to accept that script path as its first argument and remove the `GIT_DIR`/`GIT_WORK_TREE` environment overrides and bare-repository setup. The static source-contract test continues reading the active worktree file; behavioral tests intentionally exercise the immutable one-time release commit.

- [ ] **Step 3: Verify and commit the isolated runner harness**

Run the focused file and `pnpm check:ops`. Expected: all live-runner cases pass from the feature branch, and the production script still rejects non-`main` execution outside the fixture.

```bash
git add tests/ops/live-migrations.test.ts
git commit -m "test(ops): freeze live migration release fixture"
```

### Task 2: Establish the RED disposable-Postgres contract

**Files:**
- Create: `tests/db/subcategories.integration.test.ts`

- [ ] **Step 1: Add the bounded disposable database harness**

Use `randomBytes(6).toString('hex')` and reject every database name outside the exact pattern before interpolating it. Construct the child URL by replacing only `URL.pathname`. Bootstrap these exact compatibility objects before replaying migrations:

```sql
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
```

- [ ] **Step 2: Write the first failing schema and command tests**

Replay the current journal, create one owner and one household space through the existing protected commands, then assert the wished-for contract:

```ts
expect(await columnNames(client, 'categories')).toContain('parent_category_id');
await expect(createSubcategory(client, ownerId, {
  spaceId,
  requestId: randomUUID(),
  parentCategoryId: essentials.id,
  nameEn: 'Groceries',
  nameAr: null,
})).resolves.toMatchObject({ id: expect.any(String) });
```

`createSubcategory` must call only:

```sql
select * from public.create_subcategory($1, $2, $3, $4, $5)
```

Read the result back with an explicit bounded query selecting `id`, `space_id`, `kind`, `name_en`, `name_ar`, `parent_category_id`, and `archived_at`.

- [ ] **Step 3: Prove RED for the intended reason**

Run:

```bash
set -a
source /Users/daniel/Desktop/Daniel/budget-tracking/.env.test
set +a
pnpm exec vitest run tests/db/subcategories.integration.test.ts --pool=forks --no-file-parallelism
```

Expected: FAIL because `parent_category_id` and `public.create_subcategory` do not exist. Database connection, bootstrap, the existing 18 migrations, and exact disposable cleanup must succeed. Do not write migration SQL until this RED result is observed.

### Task 3: Add the minimal one-level schema and protected command

**Files:**
- Create: `supabase/migrations/20260910100000_subcategories_foundation.sql`
- Modify: `tests/db/subcategories.integration.test.ts`

- [ ] **Step 1: Add the nullable self-reference and indexes**

Create only forward SQL. The migration begins with:

```sql
alter table public.categories
  add column parent_category_id uuid,
  add constraint categories_parent_not_self_check
    check (parent_category_id is null or parent_category_id <> id),
  add constraint categories_parent_space_kind_fkey
    foreign key (parent_category_id, space_id, kind)
    references public.categories (id, space_id, kind)
    on delete restrict;

create index categories_parent_fk_idx
  on public.categories (parent_category_id, space_id, kind)
  where parent_category_id is not null;

create index categories_active_hierarchy_idx
  on public.categories (space_id, kind, parent_category_id, created_at, id)
  where archived_at is null;
```

Do not replace the deployed active-name indexes. Existing rows remain roots with a null parent.

- [ ] **Step 2: Extend the one category-command replay namespace**

Replace only the deployed check constraint in the forward migration:

```sql
alter table public.category_command_requests
  drop constraint category_command_requests_command_kind_check,
  add constraint category_command_requests_command_kind_check
    check (command_kind in (
      'create_category',
      'create_subcategory',
      'archive_category'
    ));
```

The existing `(space_id, request_id)` primary key remains unchanged.

- [ ] **Step 3: Add parent validation at the table boundary**

Create `private.validate_category_parent()` as a `SECURITY DEFINER` trigger function with `SET search_path = pg_catalog`. Return immediately for a null parent. Otherwise select the exact parent by ID, space, and kind `FOR UPDATE`; reject if it is missing, archived, or itself has a parent. Return `NEW` only after validation. This lock must conflict with the `FOR NO KEY UPDATE` lock taken by a direct owner archive update; `FOR KEY SHARE` does not protect that independent table boundary. Prove both lock orders with exactly two owner transactions and bounded lock observation, then assert rejection, final state, unchanged receipts, and transaction cleanup.

Use these stable errors:

```text
the parent category must be an active root in the requested space and kind
subcategory depth is limited to one level
```

Revoke `EXECUTE` from `PUBLIC`, `anon`, `authenticated`, and `service_role`. Add one `BEFORE INSERT` trigger named `categories_validate_parent_insert`. Preserve `categories_require_owner_insert`; do not grant raw insert privilege.

- [ ] **Step 4: Implement `public.create_subcategory`**

Use this exact signature and result:

```sql
create function public.create_subcategory(
  p_space_id uuid,
  p_request_id uuid,
  p_parent_category_id uuid,
  p_name_en text,
  p_name_ar text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
```

The body must follow this order:

1. Reject null `p_space_id`, `p_request_id`, or `p_parent_category_id` with SQLSTATE `P0001`.
2. Require non-null `auth.uid()` and `private.is_active_member(p_space_id)` with SQLSTATE `42501`.
3. Call `private.lock_category_request(p_space_id, p_request_id)`.
4. Canonicalize names with `private.canonical_category_name` and apply the same length/search-key checks as the hardened `create_category` body.
5. Build a SHA-256 fingerprint from canonical JSON containing `version: 1`, `command: create_subcategory`, `parentCategoryId`, `nameEn`, and `nameAr`.
6. Return an exact existing receipt; use `IS DISTINCT FROM` for command kind, fingerprint, and category ID comparisons.
7. Select the parent by ID and space `FOR UPDATE`, deriving `kind`; reject missing, archived, or non-root parents.
8. Insert `public.categories(space_id, kind, name_en, name_ar, parent_category_id, created_by)`.
9. Map only `categories_active_name_en_idx` and `categories_active_name_ar_idx` to `an active category already uses one of the supplied normalized names`; rethrow every other unique violation.
10. Insert one `category_command_requests` row with command kind `create_subcategory`, then return the child ID.

Use the existing owner, fixed-search-path, request-lock, and time-source patterns; do not accept a caller-supplied kind or timestamp.

- [ ] **Step 5: Apply least-privilege grants**

```sql
revoke all on function public.create_subcategory(uuid, uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.create_subcategory(uuid, uuid, uuid, text, text)
  to authenticated;
```

Run the focused test. Expected: the basic schema and valid child creation tests become GREEN before adding more behavior.

### Task 4: Enforce archive and concurrency invariants

**Files:**
- Modify: `tests/db/subcategories.integration.test.ts`
- Modify: `supabase/migrations/20260910100000_subcategories_foundation.sql`

- [ ] **Step 1: Write failing rejection and archive tests**

Add separate cases for:

- null space, request, and parent IDs;
- nonexistent, cross-space, archived, and child-as-parent inputs;
- EN-only, AR-only, bilingual, blank, marks-only Arabic, and over-120 names;
- global normalized-name conflicts between root/root, root/child, and children of different parents;
- active non-owner household-member success;
- non-member, `anon`, and `service_role` denial;
- exact replay returning the original child;
- changed parent/name replay and cross-command request-ID reuse rejection;
- direct parent-column update rejection;
- root archive rejection while an active child exists;
- child archive success followed by parent archive success; and
- preserved archived child visibility for historical reads.

Run the focused file and confirm each new assertion fails because the archive guard or exact rejection behavior is missing, not because fixture setup failed.

- [ ] **Step 2: Replace the archive-transition guard forward-only**

Use `CREATE OR REPLACE FUNCTION private.guard_category_archive_transition()` in the new migration. Preserve the existing whole-row archive-only comparison, including removal of generated key columns before comparison. When `OLD.archived_at is null` and `NEW.archived_at is not null`, reject if `NEW.parent_category_id is null` and this bounded lookup finds an active child:

```sql
exists (
  select 1
  from public.categories as child
  where child.parent_category_id = old.id
    and child.space_id = old.space_id
    and child.kind = old.kind
    and child.archived_at is null
  limit 1
)
```

Use SQLSTATE `P0001` and message `archive active subcategories before archiving their parent`. The trigger, not only the public command, must enforce this invariant.

- [ ] **Step 3: Replace `archive_category` without changing its signature**

Preserve membership, advisory request locking, fingerprint format, receipts, return shape, grants, and one-way archive update. Add explicit null checks before fingerprinting and use `IS DISTINCT FROM` for replay comparison. After replay lookup, lock the target row `FOR UPDATE`; before update, apply the same bounded active-child check and stable error as the trigger.

- [ ] **Step 4: Write and run the concurrency tests**

Open exactly two authenticated transactions behind a shared barrier. Race distinct requests that create a child and archive its root. Require exactly one fulfilled result and one rejected result, then assert exactly one valid final state:

```ts
expect([
  { parentArchived: false, activeChildren: 1 },
  { parentArchived: true, activeChildren: 0 },
]).toContainEqual(finalState);
```

Also race two exact `create_subcategory` calls with the same request ID and require the same returned ID with one receipt. Race normalized duplicate names under different parents and require one success and one stable duplicate rejection.

Run the focused suite repeatedly three times. Expected: all runs pass with no deadlock, timeout, orphaned child, or partial receipt.

- [ ] **Step 5: Commit the coherent database behavior**

Run `git diff --check` and the focused test, then commit only the migration and behavior test:

```bash
git add supabase/migrations/20260910100000_subcategories_foundation.sql \
  tests/db/subcategories.integration.test.ts
git commit -m "feat(db): add one-level subcategories"
```

Do not apply the migration to development or production yet.

### Task 5: Add migration, catalog, and source ratchets

**Files:**
- Modify: `tests/db/subcategories.integration.test.ts`
- Create: `tests/db/subcategories-source-ratchet.test.ts`
- Modify: `docs/financial-command-inventory.md`

- [ ] **Step 1: Write the seeded 18-to-19 upgrade test**

Create a second exact disposable database. Apply migrations only through `20260908103000`, then seed:

- owner and member identities plus personal and household spaces;
- active and archived income/expense categories with EN, AR, and bilingual names;
- category create/archive receipts;
- categorized income and expense events;
- a categorized reversal; and
- wallet movements and balances.

Snapshot all pre-existing columns, IDs, request fingerprints, associations, movement totals, and member-visible results. Apply only `20260910100000_subcategories_foundation.sql`, insert its journal row, then require:

```ts
expect(afterExistingState).toEqual(beforeExistingState);
expect(await scalar(client,
  'select count(*)::int from public.categories where parent_category_id is not null'
)).toBe(0);
expect(await migrationVersions(client)).toHaveLength(19);
```

The clean path must replay all 19 migrations from empty. Both paths must clean up their exact databases in `finally`.

- [ ] **Step 2: Add exact catalog assertions**

Query `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_proc`, `pg_policies`, `pg_class`, and `has_function_privilege` to prove:

- `categories_parent_not_self_check` and `categories_parent_space_kind_fkey` definitions;
- both new index definitions and predicates;
- the parent-validation and existing archive triggers;
- `public.create_subcategory(uuid,uuid,uuid,text,text)` with fixed search path and `SECURITY DEFINER`;
- effective execute true only for `authenticated`, false for `PUBLIC`, `anon`, and `service_role`;
- RLS remains enabled on `categories`;
- raw category and command-request writes remain false for authenticated and background roles; and
- existing category and financial function signatures/grants are unchanged.

Temporarily grant authenticated raw category insert/update and add a matching test-only update policy inside a rolled-back transaction. Prove the owner-write trigger still rejects direct inserts and the archive-transition trigger still rejects archiving a root with active children. As the database owner, separately attempt invalid parent inserts to prove the parent-validation trigger rejects them. Do not persist test grants or policies.

- [ ] **Step 3: Add the static source ratchet RED test**

The test reads all migration SQL with a 256-file cap and asserts:

```ts
expect(publicCategoryWriters).toEqual([
  'archive_category',
  'create_category',
  'create_subcategory',
]);
expect(subcategoryMigration.match(/create function public\.create_subcategory/g)).toHaveLength(1);
expect(subcategoryMigration).not.toMatch(/with\s+recursive|\bpath\b|\bdepth\b\s+(integer|bigint)/i);
expect(subcategoryMigration).not.toMatch(/update\s+public\.financial_events|update\s+public\.financial_event_categories/i);
```

It must also require the exact composite FK, parent-first FK index, active hierarchy index, parent validation trigger, request kind, and command ACL statements. Confirm RED before updating documentation or completing any missing migration clauses.

- [ ] **Step 4: Update the command inventory**

Add `public.create_subcategory` beside `create_category` and `archive_category` as a non-posting metadata command. State that it derives kind from one immutable active root, writes no financial row, and does not change the implemented financial-writer list.

- [ ] **Step 5: Make ratchets GREEN and commit**

Run:

```bash
set -a
source /Users/daniel/Desktop/Daniel/budget-tracking/.env.test
set +a
pnpm exec vitest run \
  tests/db/subcategories.integration.test.ts \
  tests/db/subcategories-source-ratchet.test.ts \
  --pool=forks --no-file-parallelism
git diff --check
```

Commit:

```bash
git add tests/db/subcategories.integration.test.ts \
  tests/db/subcategories-source-ratchet.test.ts \
  docs/financial-command-inventory.md
git commit -m "test(db): ratchet subcategory boundaries"
```

### Task 6: Prove compatibility and preserve the release gate

**Files:**
- Verify only.

- [ ] **Step 1: Run the complete repository gate**

```bash
set -a
source /Users/daniel/Desktop/Daniel/budget-tracking/.env.test
set +a
pnpm check
CI=1 pnpm test:e2e
git diff --check
```

Expected: operations tests and secret scan pass; TypeScript passes; all existing 59 database tests plus the new subcategory tests pass; all existing 273 UI tests pass; production build passes; and the existing applicable Playwright matrix passes with only its documented intentional skips.

- [ ] **Step 2: Prove the release manifest fails closed**

Create an empty applied-versions file in a private temporary directory and run the existing verifier against the unchanged release manifest and the now-19-file journal:

```bash
subcategory_manifest_tmp="$(mktemp -d /tmp/budget-subcategory-manifest.XXXXXXXX)"
chmod 0700 "$subcategory_manifest_tmp"
: > "$subcategory_manifest_tmp/empty-applied.txt"
scripts/ops/migrate-budget.sh verify-manifest \
  "$PWD/supabase/migrations" \
  "$PWD/ops/budget-migrations.sha256" \
  "$subcategory_manifest_tmp/empty-applied.txt" \
  00f4bf829bc0f2b16c07a2b3428c1dba45d50fe8
```

Expected: exit 79 with `unmanifested migration file`. This is a required safety result: `pnpm migrate:live` must remain unable to apply the new migration until a separate reviewed release regenerates the manifest and exact live schema receipt.

Remove only `empty-applied.txt` and then its exact private temporary directory with `rm -f -- "$subcategory_manifest_tmp/empty-applied.txt"` followed by `rmdir -- "$subcategory_manifest_tmp"`.

- [ ] **Step 3: Audit scope and status**

```bash
git status --short --branch
git diff b504286 --name-only
git log --oneline b504286..HEAD
git diff --check
```

Expected changed scope: the standalone ops-test repair, subcategory spec/plan/decisions, one new migration, two subcategory test files, and financial command inventory only. No `src/`, Cloudflare, Resend, Household, loan, wallet, or applied migration file changes are permitted.

- [ ] **Step 4: Report without overclaiming**

Report exact test counts, both disposable migration proofs, catalog/ACL results, commits, and worktree status. State explicitly:

- database implementation only;
- no UI or monthly budgeting implementation;
- no development or hosted Supabase migration applied;
- no 22-row Essentials bootstrap performed;
- no push, merge, deployment, or live-release manifest update; and
- the next serial task is Subcategories UI, while Household integration may proceed independently.

## Self-review

- **Spec coverage:** Tasks cover one immutable level, same-space/kind integrity, global name uniqueness, request replay, RLS/ACLs, archive serialization, concurrency, journal compatibility, empty replay, seeded upgrade, catalog proof, and the later owner-specific bootstrap boundary.
- **Scope coverage:** No task adds UI, budgets, reports, recursive hierarchy, reparenting, starter data, or hosted mutations.
- **Placeholder scan:** Every implementation action names an exact file, command, interface, SQL object, error, or expected result; the plan contains no unresolved implementation placeholder.
- **Type consistency:** `CategoryCommand`, `CategoryRow`, the five-argument `create_subcategory` signature, `parent_category_id`, and command-kind spelling are identical across tests, migration, catalog checks, and documentation.
- **Release safety:** The current manifest and live runner intentionally remain pinned to the reviewed 18-migration release and must reject the 19th file until a separate release approval. Their behavioral tests run from an isolated checkout of `b504286`, so the approved runner remains testable without treating feature migrations as released.
