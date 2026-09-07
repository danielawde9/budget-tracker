# Budget Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the isolated, append-only Budget database foundation with privacy, idempotency, and balance-rejection tests.

**Architecture:** The Mac repository contains migrations, a small TypeScript integration-test harness, and scripts that synchronize only Budget's Supabase directory to its dedicated Ubuntu path. The Ubuntu host runs the Budget-only Supabase stack over Tailscale; SQL functions are the sole financial mutation interface. RLS protects reads while `SECURITY DEFINER` commands validate the authenticated actor, payload, and membership inside an atomic transaction.

**Tech Stack:** TypeScript strict, pnpm, Vitest, node-postgres, PostgreSQL via Supabase CLI/Docker on Ubuntu, SQL migrations, pgcrypto, Tailscale SSH.

---

## File structure

| File | Responsibility |
| --- | --- |
| `.nvmrc` | Pins the repository Node runtime. |
| `package.json` | Reproducible test and quality commands. |
| `tsconfig.json` | Strict TypeScript boundary for test tooling. |
| `.gitignore` | Prevents database URLs, generated state, and local output from entering Git. |
| `scripts/remote-supabase.sh` | Bounded Mac-to-Ubuntu sync, remote lifecycle, and status commands. |
| `supabase/config.toml` | Budget-only local Supabase configuration on Ubuntu. |
| `supabase/migrations/20260907000100_foundation.sql` | Schema, RLS, indexes, and protected RPC commands. |
| `tests/db/foundation.integration.test.ts` | Real-Postgres proofs for journal, RLS, idempotency, and rollback behavior. |
| `tests/db/test-database.ts` | Connection, transaction, role, and assertion helpers. |
| `docs/operations/ubuntu-development-stack.md` | Repeatable isolated-stack operating procedure and rollback boundary. |
| `docs/decisions.md` | Append-only decisions discovered during setup. |

### Task 1: Establish the reproducible database-test workspace

**Files:**
- Create: `.nvmrc`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.test.example`

- [ ] **Step 1: Check proposed dependency metadata before adoption.**

Run:

```bash
pnpm view pg license version
pnpm view vitest license version
pnpm view typescript license version
```

Expected: each license is OSI-approved and versions are returned. Record any exception in `docs/decisions.md`; do not install a dependency with an unresolved licensing concern.

- [ ] **Step 2: Add the failing test command before adding the test implementation.**

Create `package.json`:

```json
{
  "name": "budget-tracker",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "test:db": "vitest run tests/db --pool=forks --no-file-parallelism",
    "test:db:watch": "vitest tests/db --pool=forks --no-file-parallelism",
    "typecheck": "tsc --noEmit",
    "check": "pnpm typecheck && pnpm test:db"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/pg": "latest",
    "pg": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

Create `.nvmrc` containing `22`, then run:

```bash
pnpm install
pnpm test:db
```

Expected: dependency installation succeeds; `test:db` fails because no test files exist yet.

- [ ] **Step 3: Add strict compiler and Vitest configuration.**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["tests/**/*.ts", "vitest.config.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
  },
});
```

Create `.gitignore`:

```gitignore
node_modules/
.env
.env.*
!.env.test.example
coverage/
.supabase/
```

Create `.env.test.example`:

```dotenv
BUDGET_TEST_DATABASE_URL=
```

Copy this file to ignored `.env.test` only after Task 2 has measured Budget's
dedicated Tailscale database endpoint. The URL is deliberately not committed:
the Budget port must not be assumed to match the existing Sandooq stack.

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit the reproducible workspace.**

```bash
git add .nvmrc package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore .env.test.example
git commit -m "chore: establish budget database test workspace"
```

### Task 2: Create a Budget-only Ubuntu Supabase lifecycle

**Files:**
- Create: `scripts/remote-supabase.sh`
- Create: `supabase/config.toml`
- Create: `docs/operations/ubuntu-development-stack.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Verify the remote target is reachable without printing secrets.**

Run:

```bash
tailscale ping 100.124.228.75
ssh daniel@100.124.228.75 'hostname && command -v rsync && command -v docker && command -v supabase'
```

Expected: Tailscale reports reachability and the host returns Docker and Supabase command paths. The replacement host does not have `rsync`; use the repository's secure-copy lifecycle script rather than installing it. If it does not, stop before creating a stack and record the precise blocker.

- [ ] **Step 2: Add the failing lifecycle test.**

Create `tests/db/remote-lifecycle.integration.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Budget remote Supabase lifecycle', () => {
  it('reports a Budget-only remote project identifier', () => {
    const output = execFileSync('./scripts/remote-supabase.sh', ['status'], {
      encoding: 'utf8',
      env: { ...process.env, BUDGET_REMOTE_CHECK_ONLY: '1' },
    });

    expect(output).toContain('budget-supabase');
  });
});
```

Run:

```bash
pnpm test:db -- tests/db/remote-lifecycle.integration.test.ts
```

Expected: FAIL because the lifecycle script does not exist.

- [ ] **Step 3: Implement bounded remote lifecycle commands.**

Create `scripts/remote-supabase.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly remote_host='daniel@100.124.228.75'
readonly remote_dir='/home/daniel/budget-supabase'
readonly local_dir='supabase'

case "${1:-}" in
  sync)
    rsync -az --delete --exclude '.temp/' "${local_dir}/" "${remote_host}:${remote_dir}/"
    ;;
  start)
    "$0" sync
    ssh "${remote_host}" "cd '${remote_dir}' && supabase start"
    ;;
  reset)
    "$0" sync
    ssh "${remote_host}" "cd '${remote_dir}' && supabase db reset"
    ;;
  status)
    if [[ "${BUDGET_REMOTE_CHECK_ONLY:-}" == '1' ]]; then
      printf '%s\n' 'budget-supabase remote lifecycle configured'
    else
      ssh "${remote_host}" "cd '${remote_dir}' && supabase status"
    fi
    ;;
  *)
    printf '%s\n' 'usage: remote-supabase.sh {sync|start|reset|status}' >&2
    exit 64
    ;;
esac
```

Mark it executable. Create `supabase/config.toml` using the Supabase CLI-generated project configuration, change only `project_id` to `budget-supabase`, and use ports not occupied by the Sandooq stack. Append a decision recording the actual assigned port set after inspecting the Ubuntu host.

The installed CLI creates most services with `unless-stopped`; after each
`start`, list containers whose names contain `budget-supabase` and apply
`docker update --restart=no` to their IDs. Expose that safeguard as
`disable-restart` so it can be reapplied without restarting services.

Run:

```bash
chmod +x scripts/remote-supabase.sh
pnpm test:db -- tests/db/remote-lifecycle.integration.test.ts
```

Expected: PASS without creating or changing a remote stack.

- [ ] **Step 4: Document the operating boundary.**

Create `docs/operations/ubuntu-development-stack.md` with these executable commands and rules:

```markdown
# Budget Ubuntu development stack

Budget runs only at `/home/daniel/budget-supabase` on `daniel@100.124.228.75`.
The Mac repository is authoritative. Never use `localhost` to reach this stack,
and never run Sandooq lifecycle commands for Budget.

```bash
./scripts/remote-supabase.sh start
./scripts/remote-supabase.sh status
./scripts/remote-supabase.sh reset
```

Before `start` or `reset`, verify the remote path is Budget-only and inspect
the Tailscale-exposed port mapping. `reset` is limited to the Budget development
stack and must never target Sandooq.
```

- [ ] **Step 5: Commit the lifecycle boundary.**

```bash
git add scripts/remote-supabase.sh supabase/config.toml tests/db/remote-lifecycle.integration.test.ts docs/operations/ubuntu-development-stack.md docs/decisions.md
git commit -m "chore: add isolated budget Supabase lifecycle"
```

### Task 3: Add space, wallet, and append-only journal schema

**Files:**
- Create: `supabase/migrations/20260907000100_foundation.sql`
- Create: `tests/db/test-database.ts`
- Create: `tests/db/foundation.integration.test.ts`

- [ ] **Step 1: Write the failing foundations test.**

Create `tests/db/foundation.integration.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, database, resetBudgetDatabase } from './test-database.js';

const ownerId = '00000000-0000-4000-8000-000000000001';

describe('financial journal foundation', () => {
  beforeAll(async () => {
    await resetBudgetDatabase();
  });

  it('keeps opening money out of received income while including it in a wallet balance', async () => {
    const owner = asUser(ownerId);
    const space = await owner.createSpace('Daniel private', 'personal');
    const wallet = await owner.createWallet(space.id, 'Pocket USD', 'USD');

    await owner.recordEvent({
      spaceId: space.id,
      requestId: '10000000-0000-4000-8000-000000000001',
      kind: 'opening_balance',
      effectiveDate: '2026-09-01',
      movements: [{ walletId: wallet.id, amountMinor: '230000' }],
    });

    expect(await owner.walletBalance(wallet.id)).toEqual('230000');
    expect(await owner.receivedIncome(space.id, '2026-09-01', '2026-09-30')).toEqual('0');
  });
});
```

Create `tests/db/test-database.ts` with functions matching the test surface:

```ts
export type SpaceKind = 'personal' | 'household';
export type Currency = 'USD' | 'LBP';
export type EventKind = 'opening_balance' | 'income' | 'expense' | 'transfer';

export interface MovementInput { walletId: string; amountMinor: string }
export interface EventInput {
  spaceId: string;
  requestId: string;
  kind: EventKind;
  effectiveDate: string;
  movements: MovementInput[];
}

export const database = undefined;
export async function resetBudgetDatabase(): Promise<void> {}
export function asUser(_userId: string) {
  return {
    createSpace: async (_name: string, _kind: SpaceKind) => ({ id: '' }),
    createWallet: async (_spaceId: string, _name: string, _currency: Currency) => ({ id: '' }),
    recordEvent: async (_event: EventInput) => ({ id: '' }),
    walletBalance: async (_walletId: string) => '',
    receivedIncome: async (_spaceId: string, _from: string, _to: string) => '',
  };
}
```

Run:

```bash
pnpm test:db -- tests/db/foundation.integration.test.ts
```

Expected: FAIL because no migrations have created the command functions.

- [ ] **Step 2: Create the minimal immutable schema.**

Create `supabase/migrations/20260907000100_foundation.sql` with the following database boundaries:

```sql
create extension if not exists pgcrypto;

create type public.space_kind as enum ('personal', 'household');
create type public.member_role as enum ('owner', 'member');
create type public.currency_code as enum ('USD', 'LBP');
create type public.financial_event_kind as enum ('opening_balance', 'income', 'expense', 'transfer', 'reversal');

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  kind public.space_kind not null,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.space_memberships (
  space_id uuid not null references public.spaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index space_memberships_user_space_idx on public.space_memberships (user_id, space_id);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  currency public.currency_code not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, space_id)
);
create index wallets_space_currency_idx on public.wallets (space_id, currency) where archived_at is null;

create table public.financial_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint bytea not null,
  kind public.financial_event_kind not null,
  effective_date date not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reversal_of uuid references public.financial_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (space_id, request_id),
  unique (id, space_id)
);
create index financial_events_space_date_idx on public.financial_events (space_id, effective_date desc, created_at desc);
create unique index financial_events_one_reversal_idx on public.financial_events (reversal_of)
  where reversal_of is not null;

create table public.wallet_movements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  space_id uuid not null,
  wallet_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  foreign key (event_id, space_id) references public.financial_events (id, space_id) on delete restrict,
  foreign key (wallet_id, space_id) references public.wallets (id, space_id) on delete restrict
);
create index wallet_movements_wallet_created_idx on public.wallet_movements (wallet_id, created_at desc);
create index wallet_movements_event_idx on public.wallet_movements (event_id);
```

Add a read-only `public.wallet_balances` view that groups `wallet_movements.amount_minor` by wallet. Do not create a stored balance column.

- [ ] **Step 3: Implement RLS and protected commands.**

In the same migration, enable RLS and use this helper and policy shape:

```sql
create schema if not exists private;

create function private.is_active_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.space_memberships memberships
    where memberships.space_id = p_space_id
      and memberships.user_id = (select auth.uid())
  );
$$;

alter table public.spaces enable row level security;
alter table public.space_memberships enable row level security;
alter table public.wallets enable row level security;
alter table public.financial_events enable row level security;
alter table public.wallet_movements enable row level security;

create policy spaces_read_for_members on public.spaces for select to authenticated
  using ((select private.is_active_member(id)));
create policy memberships_read_for_self on public.space_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy wallets_read_for_members on public.wallets for select to authenticated
  using ((select private.is_active_member(space_id)));
create policy financial_events_read_for_members on public.financial_events for select to authenticated
  using ((select private.is_active_member(space_id)));
create policy wallet_movements_read_for_members on public.wallet_movements for select to authenticated
  using ((select private.is_active_member(space_id)));
```

Then define `public.create_space`, `public.create_wallet`, `public.record_financial_event`, and `public.reverse_financial_event` as `SECURITY DEFINER` functions with `set search_path = ''`. Each function uses fully qualified names, validates `(select auth.uid())`, and begins with:

```sql
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public;
grant usage on schema public to authenticated;
grant execute on function public.create_space(text, public.space_kind) to authenticated;
```

`record_financial_event` accepts `p_movements jsonb` limited to 1–20 objects each containing a UUID `wallet_id` and string integer `amount_minor`. It hashes the canonical payload with `digest`, returns the existing event only if its fingerprint matches, rejects a mismatched replay, and validates all referenced wallets in the requested space before inserting rows. Its event shapes are: opening/income all positive; expense all negative; transfer at least two same-currency movements summing to zero.

Run:

```bash
./scripts/remote-supabase.sh reset
pnpm test:db -- tests/db/foundation.integration.test.ts
```

Expected: PASS.

- [ ] **Step 4: Replace the temporary test helper with a real role-scoped client.**

Implement `tests/db/test-database.ts` using `pg.Pool` and `BUDGET_TEST_DATABASE_URL`. Each helper opens one transaction, executes `set local role authenticated`, and sets `request.jwt.claim.sub` to the supplied UUID before calling a protected SQL function. The reset helper truncates only Budget tables as `postgres`, inserts deterministic `auth.users` fixtures, and closes the pool in `afterAll`.

Use the following RPC invocation pattern:

```ts
const result = await client.query<{ id: string }>(
  `select id from public.record_financial_event($1, $2, $3, $4::date, $5::jsonb)`,
  [input.spaceId, input.requestId, input.kind, input.effectiveDate, JSON.stringify(input.movements)],
);
```

Run:

```bash
pnpm typecheck
pnpm test:db -- tests/db/foundation.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the immutable journal foundation.**

```bash
git add supabase/migrations/20260907000100_foundation.sql tests/db/test-database.ts tests/db/foundation.integration.test.ts
git commit -m "feat: add append-only wallet journal foundation"
```

### Task 4: Prove rejection, idempotency, transfer, and correction behavior

**Files:**
- Modify: `tests/db/foundation.integration.test.ts`
- Modify: `tests/db/test-database.ts`
- Modify: `supabase/migrations/20260907000100_foundation.sql`

- [ ] **Step 1: Add failing cross-space and anonymous-read tests.**

Add these tests:

```ts
it('denies another member access to a private space', async () => {
  const owner = asUser(ownerId);
  const other = asUser('00000000-0000-4000-8000-000000000002');
  const space = await owner.createSpace('Private', 'personal');
  const wallet = await owner.createWallet(space.id, 'Cash', 'USD');

  await expect(other.walletBalance(wallet.id)).rejects.toMatchObject({ code: '42501' });
});

it('denies an anonymous financial read', async () => {
  await expect(database.anonymousWalletBalances()).rejects.toMatchObject({ code: '42501' });
});
```

Run:

```bash
pnpm test:db -- tests/db/foundation.integration.test.ts
```

Expected: FAIL until all exposed tables and views have an explicit deny-by-default policy.

- [ ] **Step 2: Add failing atomicity, event-shape, and replay tests.**

Add these cases to the same test file:

```ts
it('rejects an invalid transfer without persisting partial movements', async () => {
  const before = await owner.movementCount(space.id);
  await expect(owner.recordEvent({
    spaceId: space.id,
    requestId: '10000000-0000-4000-8000-000000000010',
    kind: 'transfer',
    effectiveDate: '2026-09-02',
    movements: [{ walletId: usd.id, amountMinor: '-1000' }, { walletId: usd2.id, amountMinor: '999' }],
  })).rejects.toMatchObject({ code: 'P0001' });
  expect(await owner.movementCount(space.id)).toEqual(before);
});

it('returns the original event for an identical replay and rejects a changed replay', async () => {
  const input = { spaceId: space.id, requestId: '10000000-0000-4000-8000-000000000011', kind: 'income' as const, effectiveDate: '2026-09-02', movements: [{ walletId: usd.id, amountMinor: '1000' }] };
  const first = await owner.recordEvent(input);
  const replay = await owner.recordEvent(input);
  expect(replay.id).toEqual(first.id);
  await expect(owner.recordEvent({ ...input, movements: [{ walletId: usd.id, amountMinor: '1001' }] })).rejects.toMatchObject({ code: 'P0001' });
});
```

Run:

```bash
pnpm test:db -- tests/db/foundation.integration.test.ts
```

Expected: FAIL until the function checks shape before inserts and compares the fingerprint on duplicate request IDs.

- [ ] **Step 3: Complete the command validation and reversal command.**

In `record_financial_event`, validate JSON object count, required keys, UUID parsing, integer-string bounds, same-space wallets, and event kind before issuing the first `insert`. Raise named SQLSTATE-compatible application errors with `raise exception using errcode = 'P0001'`.

Implement `reverse_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_effective_date date)`. It must verify membership, lock the original event with `for update`, reject an existing reversal, create a `reversal` event, and insert exactly negated movements using one `insert ... select`. It must never `update` or `delete` original journal rows.

Run:

```bash
./scripts/remote-supabase.sh reset
pnpm test:db -- tests/db/foundation.integration.test.ts
```

Expected: PASS for all tests, including the original opening-balance test.

- [ ] **Step 4: Add the successful transfer and reversal assertions.**

Add tests that assert a $100 transfer reduces one USD wallet and increases another USD wallet by exactly 10,000 minor units while received income and spending remain unchanged. Add a reversal test that asserts the original event remains queryable, exactly one linked reversal exists, and the balance returns to its prior amount.

Run:

```bash
pnpm check
```

Expected: PASS with no TypeScript diagnostics and all database tests passing.

- [ ] **Step 5: Commit the verified behavior.**

```bash
git add supabase/migrations/20260907000100_foundation.sql tests/db/test-database.ts tests/db/foundation.integration.test.ts
git commit -m "test: prove budget journal rejection behavior"
```

### Task 5: Perform the remote and rendered-proof handoff

**Files:**
- Modify: `docs/operations/ubuntu-development-stack.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Verify remote stack identity and isolation.**

Run:

```bash
./scripts/remote-supabase.sh status
ssh daniel@100.124.228.75 "cd /home/daniel/budget-supabase && supabase status"
```

Expected: only the Budget project ID and its selected ports are reported. Confirm its database system identifier is not the Sandooq identifier and that neither stack lists the other stack's tables.
Confirm every `budget-supabase` container has restart policy `no`.

- [ ] **Step 2: Run the complete evidence set.**

Run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:db
git status --short --branch
```

Expected: installation, compiler, and integration tests PASS. The status output contains only intended tracked changes; do not stage `.swarm/`.

- [ ] **Step 3: Record actual operational facts.**

Append the verified remote path, non-conflicting port set, system identifier, reset command, and test evidence to `docs/operations/ubuntu-development-stack.md` and `docs/decisions.md`. Do not write database credentials, authentication tokens, or full financial fixture data.

- [ ] **Step 4: Commit the operational handoff.**

```bash
git add docs/operations/ubuntu-development-stack.md docs/decisions.md
git commit -m "docs: record budget foundation verification"
```

## Plan self-review

- **Spec coverage:** Tasks 3–4 implement immutable events/movements, same-space validation, opening balances, transfers, reversals, RLS, atomicity, and idempotency. Task 2 implements the isolated Ubuntu/Tailscale boundary. Task 5 captures reproducible verification. Categories, savings, debts, reporting, and hosted launch are correctly outside milestone 1.
- **Placeholder scan:** The plan contains no unresolved work markers. The single generated Supabase configuration is intentionally created by the CLI because its image versions and non-conflicting ports must be measured from the active Ubuntu host; Task 2 records the exact result before it is committed.
- **Type consistency:** `SpaceKind`, `Currency`, `EventKind`, `MovementInput`, and `EventInput` are defined in `test-database.ts` and used consistently by foundation tests. SQL function names and command arguments are repeated exactly across the migration and test helper.

## Approved follow-on: Loans and whole-app ledger coverage

Daniel approved the [Loans and ledger coverage direction](../specs/2026-09-07-loans-and-ledger-coverage-design.md)
on 2026-09-07 for delivery after this foundation. It includes both "they owe me"
and "I owe them," partial/full repayments, loan history, optional due dates,
and monthly repayment targets integrated into the budget plan.

Every actual money or obligation change in every app feature must use the
shared protected journal boundary. Loan principal and wallet effects must be
posted atomically; plans remain separate until payment. The linked document
records the delivery sequence and acceptance requirements, including a coverage
inventory and rejection tests. This is deferred scope, not evidence that Loans
or whole-app enforcement is implemented or that this foundation is complete.
