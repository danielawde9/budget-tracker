# Connected Money Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the budget app's money model, schema and UI with the approved two-sided journal (wallets × purposes), and ship a working local preview seeded with the ten demonstrations.

**Architecture:** Postgres is the single authority. Tables live in a private `budget` schema that the browser cannot reach; every write is a `SECURITY DEFINER` command in `public` that builds one complete journal entry (wallet lines + purpose lines), and deferred constraint triggers re-check the invariants at commit. Every screen figure comes from read functions that sum journal lines. A new, much smaller React app (EN/AR, RTL, `cr-*` design system) calls those functions through one typed client.

**Tech Stack:** Supabase Postgres 17.6 (`public.ecr.aws/supabase/postgres:17.6.1.166`), PL/pgSQL, Supabase CLI local stack (Docker), React 19 + Vite 7 + TypeScript 7 strict, zod 4 at the client boundary, Vitest 5 (+ Testcontainers 12 for the DB), Playwright 1.55 against the local stack, pnpm 11, Node 22.22.

**Spec:** `docs/superpowers/specs/2026-10-03-connected-money-model-design.md` (approved 2026-10-03 with: top-to-bottom shortfall funding, cover-overspend-now, LBP in the same items).

**Execution note:** this plan is executed natively by the agent that wrote the spec (owner chose autonomous execution after checkpoint 1). The schema and calculation rules below are written out in full because they are checkpoint 2; UI tasks specify files, contracts and tests, and the code is written during execution.

## Global Constraints

- Work only in the worktree `.worktrees/connected-plan` on branch `redesign/connected-plan`. Never push; never run anything against hosted Supabase (`dfuxxzlhmxscgvxdmwti` is production). Never use `.env.local` for the preview.
- Money: `bigint` minor units; USD = cents, LBP = whole lira; `|amount| ≤ 1_000_000_000_000_000`. Percentages: integer basis points 0–10000. No floating point for money anywhere (SQL `numeric` only for intermediate multiplication).
- Never add amounts of different currencies. Reference rate is display-only, labelled "≈".
- Invariant per entry and currency: Σ(lines on `cash` wallets) = Σ(purpose lines). Non-ready items ≥ 0 per currency. Investment wallets ≥ 0. `i_owe` loans ≤ 0; `owed_to_me` loans ≥ 0.
- Journal is append-only (UPDATE/DELETE/TRUNCATE rejected by statement-level triggers).
- One clock: `budget.space_today(space)` in the space timezone (default `Asia/Beirut`); entries may not be future-dated; months are calendar months.
- Every user-visible string ships EN + AR; logical CSS properties only; `<bdi>` around user/DB strings and amounts; ≥44px targets; no horizontal scroll at 390px; follow `docs/design-guidelines.md` (`cr-*` only; new visual patterns get a `cr-*` class + a guideline entry in the same commit).
- Every assumption/deviation goes into `docs/decisions.md` in the same commit as the change.
- Conventional commits; commit at every green step; end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Double submit / retry after a network timeout** — the same request id must return the same entry, never two entries; a different payload with a reused id must be refused (Task 3 test `idempotency`).
2. **Correcting an entry whose money was already used** (reverse a fund after the item spent it; reverse an income that was assigned) — must be refused with a readable message, or show "over-assigned", never leave an item negative (Task 4 tests `reversal_guards`).
3. **Expense larger than its item in LBP while LBP Ready to assign is 0** — cover must come from LBP (never USD) and Ready to assign (LBP) may go negative with an "over-assigned" alert (Task 4 test `cover_same_currency`).
4. **Plan edited mid-month after partial funding** — "still to fund" must be planned − already funded, never re-fund what was funded (Task 5 test `edit_after_funding`).
5. **Opening the app in Beirut just after midnight on the 1st** — today and the month come from the space clock, not the browser or UTC (Task 2 test `space_today_timezone`; UI never computes today).

---

## File Structure (new, on the branch)

```
supabase/
  config.toml                         local stack config (site_url 127.0.0.1:5173)
  migrations/
    20261003120000_budget_core.sql    schema, types, tables, constraints, invariant triggers, privileges
    20261003120100_budget_helpers.sql clock, membership, balances, split_by_bps, plan resolution
    20261003120200_budget_commands.sql public write RPCs
    20261003120300_budget_reads.sql   public read RPCs
    20261003120400_budget_defaults.sql default groups/items seeding (EN/AR)
tests/db/
  support/postgres.ts                 Testcontainers lifecycle + template DB + per-file DB
  support/actor.ts                    run SQL as an authenticated user; rpc() helper
  core-constraints.test.ts            invariant triggers bite (rejection tests)
  privileges.test.ts                  isolation, grants, RLS layering
  commands.test.ts                    each action's two-sided shape
  plan.test.ts                        plan versions, split, flex remainder, funding preview
  reads.test.ts                       overview / plan_month / statements / bills coverage
  conservation.property.test.ts       randomized conservation
  demonstrations.test.ts              the ten demonstrations (shared scenario)
scripts/preview/
  scenario.ts                         the ten demonstrations as RPC calls (shared by seed + test)
  demo-accounts.ts                    local-only demo identities
  seed.ts                             creates demo users via local GoTrue admin, runs scenario
  up.sh                               start minimal local stack, reset DB, seed, write .env.demo.local
src/
  main.tsx  app/  api/  lib/  ui/  screens/  record/  preview/
e2e/
  flows.spec.ts                       real local backend
```

---

## Task 1: Worktree, retire v1, scaffold

**Files:** delete v1 `src/features/**`, `src/test/**`, `src/app.tsx`, `src/app.test.tsx`, `src/control-room.test.tsx`, `src/pwa-manifest.test.ts` (re-added later if still valid), `e2e/**`, `tests/**`, `worker/**`, `supabase/functions/**`, `supabase/migrations/**`, `ops/**`, `scripts/ops/**`, `scripts/check-private-uat-scope.sh`, `wrangler.jsonc`, `tsconfig.worker.json`, `worker-configuration.d.ts`, `src/i18n.ts`. Modify `package.json` scripts, `tsconfig.json` include, `vitest*.ts`, `playwright.config.ts`, `README.md`, `docs/decisions.md`.

- [ ] Create worktree `.worktrees/connected-plan` on `redesign/connected-plan` from `main`; `pnpm install --frozen-lockfile`.
- [ ] Delete the v1 trees listed above (git history keeps them). Keep `src/styles.css`, `src/control-room.css`, `src/lib/supabase.ts` (rewritten in Task 7), `public/`, `index.html`, `docs/`.
- [ ] `package.json` scripts become: `dev`, `build` (`tsc --noEmit && vite build`), `typecheck`, `test:db` (`vitest run tests/db --pool=forks --no-file-parallelism`), `test:ui` (`vitest run --config vitest.ui.config.ts`), `test:e2e`, `preview:up` (`bash scripts/preview/up.sh`), `preview:seed`, `demo` (`vite --mode demo --host 127.0.0.1 --port 5173`), `check` (`pnpm typecheck && pnpm test:db && pnpm test:ui && pnpm build`). Keep `deploy:cloudflare:frontend*` and `wrangler.frontend.jsonc` untouched (frontend-only deploy is still how v2 will ship at cutover).
- [ ] Decisions entry: "v2 rewrite on a branch; v1 release tooling retired on the branch; production cutover is a separate explicit step that resets the hosted database".
- [ ] Commit `chore(v2): retire the v1 app on the redesign branch`.

## Task 2: Core schema and invariant triggers (checkpoint 2 — schema)

**Files:** `supabase/migrations/20261003120000_budget_core.sql`, `supabase/migrations/20261003120100_budget_helpers.sql`, `tests/db/support/*.ts`, `tests/db/core-constraints.test.ts`, `tests/db/privileges.test.ts`

**Produces:** the schema below; helpers `budget.space_today(uuid) → date`, `budget.require_member(uuid) → void`, `budget.lock_space(uuid) → void`, `budget.item_balance(uuid item, budget.currency) → bigint`, `budget.ready_item(uuid space) → uuid`, `budget.wallet_balance(uuid) → bigint`, `budget.split_by_bps(bigint total, int[] bps) → bigint[]`, `budget.month_start(date) → date`.

### Schema (exact)

```sql
create schema budget;
revoke all on schema budget from public;

create type budget.currency as enum ('USD', 'LBP');
create type budget.wallet_kind as enum ('cash', 'investment', 'loan');
create type budget.loan_direction as enum ('i_owe', 'owed_to_me');
create type budget.item_kind as enum ('ready', 'spending', 'reserve', 'goal', 'flex', 'loan_payment');
create type budget.entry_kind as enum (
  'opening_balance', 'opening_assign', 'income', 'assign', 'expense', 'refund', 'transfer', 'exchange',
  'invest', 'invest_withdraw', 'invest_value', 'invest_fee', 'invest_income',
  'loan_borrow', 'loan_repay', 'loan_lend', 'loan_collect', 'loan_opening', 'reversal');
create type budget.flow as enum (
  'opening', 'income', 'other_income', 'fund', 'release', 'move', 'cover', 'spend', 'refund',
  'transfer', 'exchange', 'invest', 'withdraw', 'value', 'fee',
  'borrow', 'principal', 'interest', 'lend', 'collect');

create table budget.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  timezone text not null default 'Asia/Beirut',
  plan_currency budget.currency not null default 'USD',
  created_by uuid not null references auth.users (id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (created_by, request_id)
);
-- timezone validity is checked by trigger (pg_timezone_names lookup)

create table budget.space_members (
  space_id uuid not null references budget.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table budget.command_receipts (
  space_id uuid not null references budget.spaces (id) on delete cascade,
  request_id uuid not null,
  command text not null,
  request_hash text not null,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (space_id, request_id)
);

create table budget.reference_rates (
  space_id uuid not null references budget.spaces (id) on delete cascade,
  currency budget.currency not null check (currency <> 'USD'),
  effective_on date not null,
  units_per_usd numeric(18, 6) not null check (units_per_usd > 0),
  created_at timestamptz not null default now(),
  primary key (space_id, currency, effective_on)
);

create table budget.wallets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind budget.wallet_kind not null,
  currency budget.currency not null,
  loan_direction budget.loan_direction,
  counterparty text check (counterparty is null or char_length(btrim(counterparty)) between 1 and 60),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'loan') = (loan_direction is not null)),
  unique (id, space_id),
  unique (id, space_id, currency)
);

create table budget.plan_groups (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id) on delete cascade,
  name_en text check (name_en is null or char_length(btrim(name_en)) between 1 and 60),
  name_ar text check (name_ar is null or char_length(btrim(name_ar)) between 1 and 60),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (name_en is not null or name_ar is not null),
  unique (id, space_id)
);

create table budget.items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id) on delete cascade,
  group_id uuid,
  kind budget.item_kind not null,
  name_en text check (name_en is null or char_length(btrim(name_en)) between 1 and 60),
  name_ar text check (name_ar is null or char_length(btrim(name_ar)) between 1 and 60),
  target_minor bigint check (target_minor is null or target_minor between 1 and 1000000000000000),
  target_date date,
  wallet_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (name_en is not null or name_ar is not null),
  check ((kind = 'ready') = (group_id is null)),
  check (target_minor is null or kind in ('reserve', 'goal')),
  check (target_date is null or kind in ('reserve', 'goal')),
  check (wallet_id is null or kind in ('flex', 'loan_payment')),
  foreign key (group_id, space_id) references budget.plan_groups (id, space_id),
  foreign key (wallet_id, space_id) references budget.wallets (id, space_id),
  unique (id, space_id)
);
create unique index items_one_ready_per_space on budget.items (space_id) where kind = 'ready';
create unique index items_one_flex_per_group on budget.items (group_id) where kind = 'flex' and archived_at is null;

create table budget.plan_versions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id) on delete cascade,
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  expected_income_minor bigint not null check (expected_income_minor between 0 and 1000000000000000),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  unique (space_id, effective_month),
  unique (id, space_id)
);

create table budget.plan_version_groups (
  version_id uuid not null,
  space_id uuid not null,
  group_id uuid not null,
  percent_bps integer not null check (percent_bps between 0 and 10000),
  position integer not null check (position >= 0),
  primary key (version_id, group_id),
  unique (version_id, position),
  foreign key (version_id, space_id) references budget.plan_versions (id, space_id) on delete cascade,
  foreign key (group_id, space_id) references budget.plan_groups (id, space_id)
);

create table budget.plan_version_items (
  version_id uuid not null,
  space_id uuid not null,
  item_id uuid not null,
  group_id uuid not null,
  monthly_minor bigint not null check (monthly_minor between 0 and 1000000000000000),
  position integer not null check (position >= 0),
  primary key (version_id, item_id),
  foreign key (version_id, group_id) references budget.plan_version_groups (version_id, group_id) on delete cascade,
  foreign key (item_id, space_id) references budget.items (id, space_id)
);

create table budget.entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id) on delete cascade,
  kind budget.entry_kind not null,
  occurred_on date not null check (occurred_on >= date '2000-01-01'),
  memo text check (memo is null or char_length(memo) <= 200),
  request_id uuid not null,
  reverses_entry_id uuid unique references budget.entries (id),
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 200),
  bill_id uuid,
  bill_due_on date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (space_id, request_id),
  unique (id, space_id),
  check ((kind = 'reversal') = (reverses_entry_id is not null)),
  check ((bill_id is null) = (bill_due_on is null))
);
create index entries_space_date on budget.entries (space_id, occurred_on desc, created_at desc, id);

create table budget.wallet_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  space_id uuid not null,
  wallet_id uuid not null,
  currency budget.currency not null,
  amount_minor bigint not null check (amount_minor <> 0 and amount_minor between -1000000000000000 and 1000000000000000),
  flow budget.flow not null,
  foreign key (entry_id, space_id) references budget.entries (id, space_id),
  foreign key (wallet_id, space_id, currency) references budget.wallets (id, space_id, currency)
);
create index wallet_lines_wallet on budget.wallet_lines (wallet_id);
create index wallet_lines_entry on budget.wallet_lines (entry_id);

create table budget.item_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  space_id uuid not null,
  item_id uuid not null,
  currency budget.currency not null,
  amount_minor bigint not null check (amount_minor <> 0 and amount_minor between -1000000000000000 and 1000000000000000),
  flow budget.flow not null,
  foreign key (entry_id, space_id) references budget.entries (id, space_id),
  foreign key (item_id, space_id) references budget.items (id, space_id)
);
create index item_lines_item on budget.item_lines (item_id, currency);
create index item_lines_entry on budget.item_lines (entry_id);

create table budget.bills (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budget.spaces (id) on delete cascade,
  item_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000000),
  currency budget.currency not null,
  cadence text not null check (cadence in ('monthly', 'yearly', 'once')),
  first_due_on date not null,
  end_on date check (end_on is null or end_on >= first_due_on),
  loan_wallet_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (item_id, space_id) references budget.items (id, space_id),
  foreign key (loan_wallet_id, space_id) references budget.wallets (id, space_id),
  unique (id, space_id)
);
alter table budget.entries add foreign key (bill_id, space_id) references budget.bills (id, space_id);

create table budget.bill_skips (
  bill_id uuid not null,
  space_id uuid not null,
  due_on date not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (bill_id, due_on),
  foreign key (bill_id, space_id) references budget.bills (id, space_id)
);
```

### Invariant triggers (deferred, defense in depth)

- `budget.check_entry_balanced()` — `constraint trigger ... after insert on wallet_lines / item_lines deferrable initially deferred for each row`: for `new.entry_id`, for every currency, `Σ wallet_lines on wallets.kind='cash'` must equal `Σ item_lines`; raises `BUDGET_UNBALANCED_ENTRY`.
- `budget.check_entry_has_lines()` — deferred on `entries` insert: at least one wallet or item line; raises `BUDGET_EMPTY_ENTRY`.
- `budget.check_item_nonnegative()` — deferred on `item_lines` insert: for `(new.item_id, new.currency)`, if item kind ≠ 'ready', balance ≥ 0; raises `BUDGET_ITEM_NEGATIVE`.
- `budget.check_wallet_bounds()` — deferred on `wallet_lines` insert: investment ≥ 0; loan `i_owe` ≤ 0; loan `owed_to_me` ≥ 0; raises `BUDGET_WALLET_BOUNDS`.
- `budget.check_reversal_mirror()` — deferred on `entries` insert where kind = 'reversal': the reversal's wallet and item lines are exactly the negation (same wallet/item, currency, flow) of the original's; raises `BUDGET_BAD_REVERSAL`.
- `budget.check_plan_percent_total()` — deferred on `plan_version_groups` insert/update: Σ bps per version ≤ 10000; raises `BUDGET_PLAN_OVER_100`.
- `budget.check_plan_item_group()` — on `plan_version_items`: item's kind not in ('ready','flex') and `items.group_id = plan_version_items.group_id`; raises `BUDGET_PLAN_ITEM_INVALID`.
- `budget.reject_mutation()` — `before update or delete or truncate ... for each statement` on `entries`, `wallet_lines`, `item_lines`, `command_receipts`, `bill_skips`; raises `BUDGET_APPEND_ONLY`.
- `budget.check_space_timezone()` — before insert/update on spaces: `exists (select 1 from pg_timezone_names where name = new.timezone)`.

### Privileges

- `alter table ... enable row level security` on every `budget` table, no policies (deny-all if a grant ever leaks).
- No grants on schema `budget` to `anon`, `authenticated`, `service_role`.
- After every function migration: `revoke execute on all functions in schema public from public, anon, service_role;` then `grant execute on function public.<each rpc> to authenticated;`. Helpers in `budget` are `security definer`-free and unreachable (no schema usage).

### Tests

`tests/db/support/postgres.ts`: start one Testcontainers `GenericContainer('public.ecr.aws/supabase/postgres:17.6.1.166')` per run (vitest `globalSetup`), env `POSTGRES_PASSWORD`, wait for `select 1`; build `budget_template` by applying `supabase/migrations/*.sql` in order as `postgres`; each test file calls `freshDatabase()` → `create database t_<rand> template budget_template` and returns a `pg.Pool`.

`tests/db/support/actor.ts`: `createUser(pool, email) → uuid` (insert into `auth.users`); `asUser(pool, userId, fn)` runs `fn(client)` inside `begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', userId, 'role', 'authenticated')::text, true); … commit`; `rpc(client, name, args) → unknown` calls `select public.<name>(<named args>) as r`.

`core-constraints.test.ts` (each test runs as `postgres` inserting rows directly, so the commands are bypassed and only triggers stand):
- unbalanced entry (cash wallet +100, no item line) → commit fails `BUDGET_UNBALANCED_ENTRY`
- off-budget only entry (investment +100, no item line) → commits (investment lines are outside the identity)
- item line making a spending item negative → `BUDGET_ITEM_NEGATIVE`; same for ready item → commits
- investment wallet below zero → `BUDGET_WALLET_BOUNDS`; `i_owe` loan positive → `BUDGET_WALLET_BOUNDS`
- `update`, `delete` (including a zero-row `delete ... where false`), `truncate` on `entries`, `wallet_lines`, `item_lines` → `BUDGET_APPEND_ONLY`
- reversal whose lines are not the mirror → `BUDGET_BAD_REVERSAL`
- plan version groups totalling 10001 bps → `BUDGET_PLAN_OVER_100`
- `budget.split_by_bps(411000, '{6000,500,1500,1000,1000}')` = `{246600,20550,61650,41100,41100}`; `split_by_bps(100, '{3333,3333,3334}')` = `{33,33,34}`; `split_by_bps(100, '{5000}')` = `{50}`; Σ with Σbps=10000 always equals total (loop 200 random cases)
- `space_today_timezone`: with `now()` pinned via a `begin; set local timezone` independent check — `budget.space_today` for a space in `Asia/Beirut` equals `(now() at time zone 'Asia/Beirut')::date` and differs from UTC date when tested at a fixed timestamp via a helper `budget.space_date_at(space, timestamptz)`.

`privileges.test.ts`:
- `authenticated` cannot `select` from `budget.entries` (permission denied for schema budget)
- grant `usage on schema budget` + `select on budget.entries` to authenticated inside the test → still zero rows (RLS layer holds)
- `anon` cannot execute `public.create_space`
- user B calling any read/command on user A's space → `BUDGET_NOT_MEMBER` (42501)

- [ ] Write the tests, run `pnpm test:db` → fail (no schema). Write migrations. Run → pass. Commit `feat(db): add the two-sided journal schema and invariant triggers`.

## Task 3: Commands (checkpoint 2 — calculation rules)

**Files:** `supabase/migrations/20261003120200_budget_commands.sql`, `supabase/migrations/20261003120400_budget_defaults.sql`, `tests/db/commands.test.ts`

**Internal (schema `budget`, not callable by clients):**
- `budget.begin_command(p_space uuid, p_request uuid, p_command text, p_payload jsonb) returns jsonb` — `require_member`, `lock_space` (`select … for update` on the space row), then if a receipt exists: same `sha256(p_command || p_payload::text)` → return stored `result`; different → raise `BUDGET_REQUEST_CONFLICT`; else return null.
- `budget.finish_command(p_space, p_request, p_command, p_payload, p_result jsonb) returns jsonb` — insert receipt, return result.
- `budget.new_entry(p_space, p_request, p_kind, p_on date, p_memo, p_bill uuid default null, p_bill_due date default null) returns uuid` — validates `p_on ≤ space_today`, `≥ 2000-01-01`.
- `budget.add_wallet_line(p_entry, p_space, p_wallet, p_amount, p_flow)` — wallet must be active, same space; currency taken from wallet.
- `budget.add_item_line(p_entry, p_space, p_item, p_currency, p_amount, p_flow)` — item must be active, same space.
- `budget.charge_item(p_entry, p_space, p_item, p_currency, p_amount, p_flow, p_cover_from uuid)` — the overspend rule: `shortfall = greatest(0, p_amount − item_balance(item, currency))`; if `shortfall > 0`: source = `p_cover_from` (must hold ≥ shortfall, same currency, not the charged item) or the ready item; lines `source −shortfall cover`, `item +shortfall cover`; then `item −p_amount p_flow`. Returns shortfall.
- `budget.assert_ready_not_deepened(p_entry)` — for each currency where this entry's ready lines sum < 0, the ready balance after the entry must be ≥ 0, else `BUDGET_INSUFFICIENT_READY`.

**Public commands** (all `security definer`, `set search_path = ''`, return `jsonb` `{ "entryId": … }` or the created ids; amounts are `bigint` > 0 unless stated):

| RPC | Arguments | Lines written |
| --- | --- | --- |
| `create_space` | `p_request uuid, p_name text, p_expected_income_minor bigint default 0, p_timezone text default 'Asia/Beirut', p_with_defaults boolean default true, p_plan_month date default null` | none; creates space, owner membership, ready item, default groups/items + a plan version at `p_plan_month` (default: current month) |
| `create_wallet` | `p_space, p_request, p_name, p_kind, p_currency, p_opening_minor bigint default 0, p_opened_on date default null, p_loan_direction default null, p_counterparty default null` | opening ≠ 0: cash → wallet ±X `opening`, ready ±X `opening`; investment → wallet +X `opening` (X > 0); loan → `i_owe` wallet −X / `owed_to_me` +X `opening` (input X > 0); entry kinds `opening_balance` / `loan_opening` dated `coalesce(p_opened_on, space_today)` |
| `update_wallet` | `p_space, p_request, p_wallet, p_name text, p_archived boolean` | none; archiving requires balance 0 (`BUDGET_ARCHIVE_NONZERO`) |
| `assign_money` | `p_space, p_request, p_on date, p_moves jsonb, p_opening boolean default false, p_memo text default null` | `p_moves = [{from: uuid|null, to: uuid|null, currency, amountMinor}]`, 1–60 rows; null = ready; ready→item `fund`, item→ready `release`, item→item `move`; opening=true allows only ready→item with flow `opening` and entry kind `opening_assign`; then `assert_ready_not_deepened` |
| `record_income` | `p_space, p_request, p_wallet, p_amount, p_on, p_memo default null, p_item default null` | cash wallet +X `income`; ready +X `income`; if `p_item`: ready −X `fund`, item +X `fund` |
| `record_expense` | `p_space, p_request, p_wallet, p_item, p_amount, p_on, p_memo default null, p_cover_from default null, p_bill default null, p_bill_due default null` | cash wallet −X `spend`; `charge_item(item, X, 'spend', cover_from)`; bill occurrence must be due on that date, unpaid and not skipped (`BUDGET_BILL_ALREADY_PAID`) |
| `record_refund` | `p_space, p_request, p_wallet, p_item, p_amount, p_on, p_memo default null` | wallet +X `refund`; item +X `refund` |
| `record_transfer` | `p_space, p_request, p_from, p_to, p_amount, p_on, p_memo default null` | both cash, same currency, distinct (`BUDGET_TRANSFER_INVALID`): from −X, to +X `transfer` |
| `record_exchange` | `p_space, p_request, p_from, p_from_amount, p_to, p_to_amount, p_item uuid null, p_on, p_memo default null` | both cash, different currencies; from −a, to +b `exchange`; item (or ready) −a (cur1) +b (cur2) `exchange`; item must hold a (no cover); `assert_ready_not_deepened` |
| `record_investment` | `p_space, p_request, p_action text, p_investment uuid, p_amount, p_on, p_cash uuid default null, p_item uuid default null, p_cover_from default null, p_memo default null` | `contribute`: cash −X, inv +X `invest`, `charge_item(item, X, 'invest')`; `withdraw`: inv −X, cash +X `withdraw`, ready +X `withdraw`; `value`: X = new total value ≥ 0, delta = X − balance ≠ 0, inv ±delta `value` (kind `invest_value`); `fee`: inv −X `fee`; `income_cash`: cash +X, ready +X `other_income`; `income_reinvested`: inv +X `other_income` |
| `record_loan` | `p_space, p_request, p_action text, p_loan uuid, p_on, p_principal bigint, p_interest bigint default 0, p_fee bigint default 0, p_cash uuid default null, p_item uuid default null, p_cover_from default null, p_memo default null, p_bill default null, p_bill_due default null` | `borrow` (i_owe): loan −P, cash +P `borrow`, ready +P `borrow`; `repay` (i_owe): cash −P `principal`, −I `interest`, −F `fee`; loan +P `principal`; `charge_item(item, P,'principal')`, `(I,'interest')`, `(F,'fee')`; `lend` (owed_to_me): cash −P `lend`, loan +P `lend`, item-or-ready −P `lend` (`charge_item` when item, `assert_ready_not_deepened` when ready); `collect`: cash +P, loan −P `collect`, ready +P `collect`, interest I: cash +I, ready +I `other_income` |
| `reverse_entry` | `p_space, p_request, p_entry, p_reason text` | new `reversal` entry dated as the original, every line negated; refuses reversal of a reversal or an already-reversed entry (`BUDGET_ALREADY_REVERSED`) |
| `save_bill` | `p_space, p_request, p_bill uuid default null, p_name, p_item, p_amount, p_currency, p_cadence, p_first_due date, p_end date default null, p_loan default null, p_archived boolean default false` | none |
| `skip_bill` | `p_space, p_request, p_bill, p_due date` | none |
| `set_reference_rate` | `p_space, p_request, p_currency, p_units_per_usd numeric, p_effective date` | none |

Errors are raised as `raise exception using errcode = 'P0001', message = 'BUDGET_<CODE>', detail = <json>` (or `42501` for `BUDGET_NOT_MEMBER`), so PostgREST returns `{code, message, details}` and the UI maps `message` to EN/AR text.

**Defaults** (`budget.seed_default_plan(space, month, expected_income)`), names EN/AR:
- Essentials / الأساسيات 6000: Rent / الإيجار (spending), Bills / الفواتير (spending), Groceries / البقالة (spending), Transport / المواصلات (spending), Insurance reserve / احتياطي التأمين (reserve) — monthly amounts 0 until the owner sets them; flex: Other essentials / أساسيات أخرى
- Guilt free / بلا ذنب 500: Eating out / المطاعم, Fun / الترفيه; flex: Other guilt-free / ترفيه آخر
- Short-term goals / أهداف قصيرة المدى 1500: flex: Goals money / مال الأهداف
- Savings / الادخار 1000: flex: General savings / ادخار عام
- Investments / الاستثمار 1000: flex: To invest / للاستثمار

**Tests (`commands.test.ts`)** — one `describe` per row above, each asserting the exact lines written (wallet, item, currency, amount, flow) via a helper `entryLines(entryId)`, plus:
- `idempotency`: same request twice → same `entryId`, one entry; same id, different amount → `BUDGET_REQUEST_CONFLICT`
- expense within balance → no cover lines; expense $135.50 on $120 with `p_cover_from = Fun` → Fun −15.50 `cover`, Eating out +15.50 `cover`, −135.50 `spend`; cover source too small → `BUDGET_INSUFFICIENT_ITEM`
- `cover_same_currency`: LBP expense on an item with LL 0 and LBP ready 0 → LBP ready −X (allowed), USD untouched
- fund more than ready → `BUDGET_INSUFFICIENT_READY`; move more than item → `BUDGET_ITEM_NEGATIVE` (trigger) surfaced as `BUDGET_INSUFFICIENT_ITEM` by the command's own pre-check
- transfer across currencies → `BUDGET_TRANSFER_INVALID`; transfer to investment wallet → `BUDGET_TRANSFER_INVALID`
- future date → `BUDGET_FUTURE_DATE`
- `reversal_guards`: reverse a fund after the item spent it → `BUDGET_INSUFFICIENT_ITEM`; reverse an assigned income → succeeds and ready becomes negative ("over-assigned"); reverse twice → `BUDGET_ALREADY_REVERSED`
- bill paid twice for the same due date → `BUDGET_BILL_ALREADY_PAID`; after reversing the payment, paying again succeeds
- archive wallet with balance → `BUDGET_ARCHIVE_NONZERO`

- [ ] Tests first (fail), implement, pass, commit `feat(db): add the journal commands with cover, idempotency and guards`.

## Task 4: Plan editing and funding (checkpoint 2 — plan rules)

**Files:** `supabase/migrations/20261003120200_budget_commands.sql` (append `save_plan`), `supabase/migrations/20261003120100_budget_helpers.sql` (plan resolution), `tests/db/plan.test.ts`

**Rules:**
- `budget.plan_version_for(space, month) → uuid`: version with max `effective_month ≤ month`; null if none.
- Group amounts: `split_by_bps(expected_income, bps[] in position order)`.
- Item planned amounts: stored `monthly_minor`; flex planned = `greatest(0, group_amount − Σ other items in group)`; group over = `greatest(0, Σ items − group_amount)`.
- `funded_net(item, month, currency)` = Σ item lines with flow in (`fund`,`release`) dated in month.
- `still_to_fund(item, month)` = `greatest(0, planned − funded_net)`.
- Funding order: groups by `position`, non-flex items by `position`, then the group's flex item.

**`save_plan(p_space, p_request, p_month date, p_expected_revision integer, p_plan jsonb) returns jsonb`** — `p_plan`:
```json
{ "expectedIncomeMinor": "411000",
  "groups": [ { "groupId": "uuid|null", "nameEn": "Essentials", "nameAr": "الأساسيات", "percentBps": 6000,
                "flexNameEn": "Other essentials", "flexNameAr": "أساسيات أخرى",
                "items": [ { "itemId": "uuid|null", "kind": "spending|reserve|goal|loan_payment",
                             "nameEn": "Rent", "nameAr": "الإيجار", "monthlyMinor": "100000",
                             "targetMinor": null, "targetDate": null, "walletId": null } ] } ],
  "archiveItemIds": [], "archiveGroupIds": [] }
```
Behaviour: any month may be edited (the UI defaults to the current month and warns that a past-month edit applies to that month and later months until the next version); if a version exists exactly at `p_month`, `p_expected_revision` must equal its revision (`BUDGET_STALE_PLAN`) and it is replaced (revision + 1); otherwise a new version is inserted at `p_month` (`p_expected_revision` must equal the revision of the version currently in effect, or null if none). New groups get a flex item; new items are created; existing items may change name/target/group (not kind); archived items/groups need zero balances (`BUDGET_ARCHIVE_NONZERO`). Σ bps ≤ 10000. Returns `{ "versionId", "revision" }`.

**`funding_preview(p_space, p_month, p_currency default plan currency, p_amount bigint default null) returns jsonb`** — `{ "available": "…", "lines": [{ "itemId", "amountMinor" }], "unfunded": "…" }` where available = `coalesce(p_amount, greatest(0, ready balance))`, lines filled top to bottom by `still_to_fund`.

**Tests (`plan.test.ts`):** the $4,110 plan: group amounts 246600/20550/61650/41100/41100 cents; Essentials flex = 1600; Guilt-free flex = 0; over-planned group (items 2,500 in a 2,466 group) reports over 3400 and flex 0; Σbps 9000 → not planned 41100; `save_plan` stale revision → `BUDGET_STALE_PLAN`; edit at October keeps September's version intact; preview with ready 2,055 → Rent 1000, Bills 250, Groceries 600, Transport 205 then stop; `edit_after_funding`: fund 2,055, raise Groceries to 700 → preview fills Groceries 100 more before continuing to Transport; preview never proposes an item whose funded ≥ planned.

- [ ] Tests first, implement, pass, commit `feat(db): add effective-dated plans and top-to-bottom funding`.

## Task 5: Read functions

**Files:** `supabase/migrations/20261003120300_budget_reads.sql`, `tests/db/reads.test.ts`

All return `jsonb`, amounts as decimal strings of minor units, per currency where relevant.

- `my_spaces()` → `[{ id, name, role, timezone, planCurrency, today }]`
- `space_overview(p_space)` → `{ today, month, currencies: { USD: { cashHeld, setAside, ready, setAsideByGroup: [{groupId, nameEn, nameAr, amount}], netWorth: { cash, investments, owedToMe, iOwe, total } }, LBP: {…} }, plan: { month, expectedIncome, received, funded, stillToFund }, alerts: [{ kind: 'over_assigned'|'still_to_fund'|'bill_short'|'bill_overdue'|'item_over_planned', currency, amount, itemId?, billId?, dueOn? }], referenceRate: { currency:'LBP', unitsPerUsd, effectiveOn } | null }`
- `plan_month(p_space, p_month)` → `{ month, versionId, revision, effectiveMonth, expectedIncome, groupsTotal, notPlanned, overPlanned, received, funded, stillToFund, ready, groups: [{ groupId, nameEn, nameAr, percentBps, planned, funded, spent, available, over, items: [{ itemId, kind, nameEn, nameAr, planned, funded, broughtForward, opening, movedIn, movedOut, coveredIn, coveredOut, spent, otherOut, exchanged, available, lbpAvailable, targetMinor, targetDate, walletId }] }] }`. "available" is the balance at month end (or now for the current month). `spent` = −Σ(`spend`,`refund`,`interest`,`fee`); `otherOut` = −Σ(`invest`,`principal`,`lend`).
- `item_statement(p_space, p_item, p_month)` → the month row for one item + `entries: [{ entryId, kind, occurredOn, memo, amount, currency, flow, walletName, counterpartItemName }]` (≤ 200 rows, newest first).
- `activity_page(p_space, p_limit int default 30, p_before jsonb default null, p_filter jsonb default '{}')` → keyset page over `(occurred_on desc, created_at desc, id)`; each entry with its lines resolved to names; `reversedBy` / `reverses`; filter keys `walletId`, `itemId`, `kind`, `month`.
- `accounts_overview(p_space)` → `{ wallets: [{ id, name, kind, currency, balance, archived, loanDirection, counterparty, contributed?, gain? }] }` where for investments `contributed` = Σ(`opening`,`invest`,`withdraw`) and `gain` = Σ(`value`,`fee`,`other_income`).
- `bills_upcoming(p_space, p_from date, p_to date)` (span ≤ 400 days) → `[{ billId, name, itemId, itemName, currency, expected, dueOn, status: 'paid'|'skipped'|'due'|'overdue', paidAmount, entryId, coverage: 'covered'|'short'|'not_covered'|null, shortBy }]`. Coverage per item: unpaid occurrences due ≤ end of the current month, ordered by due date, consumed against the item balance.
- `funding_preview` (Task 4).

**Tests (`reads.test.ts`):** after a small script (opening 5,500 → assign 4,280 → income 4,110 → fund via preview → spend): `space_overview.USD.cashHeld = setAside + ready` exactly; `setAsideByGroup` sums to setAside; `plan_month` September item statement for Holiday: opening 800, funded 400, broughtForward 0; October: broughtForward 1,200, funded 400, movedIn 150; overview never lists LBP inside USD totals; bills: Internet covered, a bill larger than its item → short with `shortBy`; activity page keyset returns no duplicates across pages.

- [ ] Tests first, implement, pass, commit `feat(db): add derived read functions for every screen`.

## Task 6: Scenario, conservation property test, demonstrations

**Files:** `scripts/preview/scenario.ts`, `tests/db/demonstrations.test.ts`, `tests/db/conservation.property.test.ts`

**Produces:** `export interface ScenarioCaller { call<T>(rpc: string, args: Record<string, unknown>): Promise<T> }`; `export async function runFreshSetup(c, ids)`; `export async function runExistingMoneyStory(c, today: string) → StoryRefs` executing §6 of the spec with dates anchored to the month of `today` (setup = 1st of previous month; current-month events on days 1–3 clamped to today; if today's day < 3 the story shifts one month back).

`demonstrations.test.ts` runs `runExistingMoneyStory` anchored at the database's real `space_today` (the story's dates are relative to that month, so every asserted figure is month-independent) and asserts: Ready to assign 1,320.00; set aside 7,392.60; Bank 8,444.60; Cash 268.00; Groceries 650.10 + LL 2,685,000; General savings 3,672.00; Holiday 1,750.00 (opening 800, funded 800, moved 150); Insurance 0 and bill paid; Brokerage 12,971.00 (gain 149); car loan −5,658.00; Rami 200.00; net worth 16,225.60; September group spending Guilt free 175.50; plan-wide October funded 4,110.00.

`conservation.property.test.ts`: seeded PRNG (mulberry32, seeds 1..40), 60 random actions per seed drawn from {income, fund, release, move, expense with random cover, refund, transfer, exchange, invest, withdraw, value, borrow, repay, lend, collect, reverse random entry}; invalid actions are allowed to be refused (only refusals with `BUDGET_*` codes are tolerated). After every action assert per currency: cashHeld = ready + Σ items; every non-ready item ≥ 0; Σ `income` flows unchanged by transfers/moves/funds (compare totals before/after those actions); Σ `fund` never counts `opening`; reversing then re-querying returns all balances to the pre-entry values.

- [ ] Write, run, fix, commit `test(db): prove conservation and the ten demonstrations`.

## Task 7: Client foundation

**Files:** `src/lib/money.ts`, `src/lib/money.test.ts`, `src/lib/plan-math.ts`, `src/lib/plan-math.test.ts`, `src/lib/i18n.tsx`, `src/lib/i18n.test.ts`, `src/lib/supabase.ts`, `src/api/errors.ts`, `src/api/schemas.ts`, `src/api/budget-api.ts`, `src/api/budget-api.test.ts`, `src/api/request-id.ts`, `tests/db/plan-math-parity.test.ts`

**Produces:**
- `type Currency = 'USD' | 'LBP'`; `const CURRENCY_DECIMALS: Record<Currency, 0 | 2>`; `formatMoney(minor: bigint, currency: Currency, locale: Locale, opts?: { sign?: boolean }) → string`; `parseMoney(text: string, currency: Currency) → bigint | null` (accepts Arabic-Indic digits, `,`/`٬` grouping, `.`/`٫` decimal, rejects > decimals); `approxUsd(minorLbp: bigint, unitsPerUsd: string) → bigint` (half-even to cents).
- `splitByBps(total: bigint, bps: number[]) → bigint[]` (identical to SQL); `flexPlanned(groupAmount, items) → bigint`; `groupOver(...)`.
- `type Locale = 'en' | 'ar'`; `LocaleProvider`, `useI18n() → { locale, t(key, vars?), dir }`; one dictionary `messages: Record<MessageKey, { en: string; ar: string }>`; error codes map to keys `error.BUDGET_*`.
- `createBudgetApi(client: SupabaseClient) → BudgetApi` with one method per RPC; responses parsed by zod; failures thrown as `BudgetError { code: string; detail?: unknown }` (handles PostgREST plain-object errors — never `instanceof Error` checks on them); 15 s timeout via `AbortSignal.timeout`.
- `newRequestId() → string` (crypto.randomUUID).

**Tests:** money formatting/parsing tables (EN/AR, both currencies, negatives, 205.50, LL 4,475,000, bad inputs); `splitByBps` cases from Task 2; `plan-math-parity.test.ts` (db suite): 2,000 random `(total, bps[])` → TS result equals `budget.split_by_bps`; `budget-api.test.ts`: a fake client returning a plain `{code:'P0001', message:'BUDGET_INSUFFICIENT_READY'}` yields `BudgetError('BUDGET_INSUFFICIENT_READY')`; a malformed payload fails loudly.

- [ ] Tests first, implement, commit `feat(client): add money, plan math, i18n and the typed budget API`.

## Task 8: App shell, auth, onboarding, preview guard

**Files:** `src/main.tsx`, `src/app/app.tsx`, `src/app/use-session.ts`, `src/app/auth-screen.tsx`, `src/app/shell.tsx`, `src/app/router.ts`, `src/app/space-context.tsx`, `src/screens/onboarding/onboarding.tsx`, `src/preview/demo-mode.ts`, `src/app/app.test.tsx`

- Hash router: `#/home`, `#/plan/:month?`, `#/activity`, `#/accounts`, `#/settings`; default `#/home`.
- `demo-mode.ts`: in mode `demo`, refuse to render unless `VITE_SUPABASE_URL` host is `127.0.0.1`/`localhost` (fail closed, visible error); exposes demo sign-in buttons (accounts from `scripts/preview/demo-accounts.ts` via `import.meta.env`).
- Shell: desktop rail (brand, space switcher, Record button, four destinations) / mobile top bar + tab bar with centre Record; EN/AR toggle; reuses `cr-rail`, `cr-tabbar`, `cr-tab`, `cr-fab`.
- Onboarding wizard (`cr-wizard-*`, 4 steps): space name → expected income → plan groups (accept defaults, edit % and item amounts inline) → first wallet(s) with opening balance and optional "What is this money for?" assignment. Calls `create_space`, `save_plan`, `create_wallet`, `assign_money(opening)`.
- Test: config-missing screen; demo guard refuses a non-local URL; onboarding happy path with a fake API calls the RPCs in order with stable request ids.

- [ ] Implement, test, commit `feat(app): add the shell, auth, onboarding and the local preview guard`.

## Task 9: Home and Accounts

**Files:** `src/screens/home/home.tsx`, `src/screens/home/money-equation.tsx`, `src/screens/home/alerts.tsx`, `src/screens/home/upcoming.tsx`, `src/screens/accounts/accounts.tsx`, tests alongside.

- Home: per currency "Cash you hold = Set aside + Ready to assign" (`.cr-amount--dashboard`), set-aside by group, alerts in plain words with an action each (Fund my plan, Cover, Pay bill), upcoming bills (next 30 days) with coverage pill and Pay action, last 5 activity rows, net worth card.
- Accounts: wallets grouped Spending / Investments / Loans with balances; add wallet (opening balance); investment row actions: Contribute, Update value, Withdraw; loan row actions: Repay / Collect, Borrow more / Lend more.
- Tests: equation renders three amounts that satisfy the identity from fixture data; LBP never summed into USD; an alert's action opens the right dialog.

- [ ] Implement, test, commit `feat(ui): add Home and Accounts`.

## Task 10: Plan screen (Plan + Allocation merged)

**Files:** `src/screens/plan/plan.tsx`, `src/screens/plan/group-card.tsx`, `src/screens/plan/item-row.tsx`, `src/screens/plan/item-statement.tsx`, `src/screens/plan/plan-editor.tsx`, `src/screens/plan/fund-dialog.tsx`, `src/screens/plan/move-dialog.tsx`, tests alongside.

- Header: month selector (prev/next), Expected · Received · Funded · Still to fund · Ready to assign; actions **Fund my plan**, **Move money**, **Edit plan**.
- Group card: name, %, planned, funded, spent, available, over/flex notes; expands to items with the same columns; goals/reserves show a progress bar (`.cr-progress`) toward target and target date; LBP balance shown as a second line.
- Item statement drawer: Brought forward / Opening / Funded / Moved in / Moved out / Covered / Spent / Other outflows / Exchanged / Left.
- Fund dialog: `funding_preview` lines editable per item; total vs available; confirm → `assign_money`.
- Move dialog: from item (or Ready) → to item (or Ready), currency, amount → `assign_money`.
- Plan editor: income; groups (rename, %, reorder up/down, add/remove); items per group (add with kind, rename, monthly amount, target/date for goals/reserves, reorder, move group, archive); live math via `plan-math.ts`; shows "Other essentials gets $16.00" / "Over by $34.00" / "Not planned 10%"; save → `save_plan` with revision; stale → reload prompt.
- Tests: plan math labels for the $4,110 fixture; fund dialog sums and refuses over-available; stale revision message.

- [ ] Implement, test, commit `feat(ui): add the merged Plan with funding, moves and editing`.

## Task 11: Record sheet, bills, Activity, Settings

**Files:** `src/record/record-sheet.tsx`, `src/record/expense-form.tsx`, `src/record/income-form.tsx`, `src/record/transfer-form.tsx`, `src/record/exchange-form.tsx`, `src/record/invest-form.tsx`, `src/record/loan-form.tsx`, `src/screens/bills/bill-editor.tsx`, `src/screens/bills/pay-bill-dialog.tsx`, `src/screens/activity/activity.tsx`, `src/screens/settings/settings.tsx`, tests alongside.

- Record sheet (`DialogShell`-style dialog via new `src/ui/dialog.tsx`, focus trap, Escape, return focus): type chips Expense · Income · Transfer · Move · Exchange · Invest · Loan; each form validates locally (amount > 0, required pickers) and calls one RPC with a request id created when the form opens; the expense form shows the item's available amount and, when short, "X will come from [Ready to assign ▾]" with a source picker; success shows a one-line result and stays open for another entry.
- Bills: editor (name, item, amount, currency, cadence, first due, end, loan); pay dialog (prefilled amount/date, wallet, interest split for loan bills) → `record_expense` / `record_loan` with bill reference; skip.
- Activity: keyset list with filters (month, wallet, item, type), each row in plain words ("Groceries · Bank · −$85.40"), reversal badge, "Correct" → reason → `reverse_entry` then opens the same form prefilled.
- Settings: language, reference rate (LBP per USD + date), space name, sign out.
- Tests: expense form shows cover message and passes `p_cover_from`; double click on submit sends one request id (second resolves to same entry via fake); correction calls `reverse_entry` with a reason.

- [ ] Implement, test, commit `feat(ui): add recording, bills, activity and settings`.

## Task 12: Local preview and guided tour

**Files:** `supabase/config.toml`, `scripts/preview/up.sh`, `scripts/preview/seed.ts`, `scripts/preview/demo-accounts.ts`, `src/preview/tour.tsx`, `docs/operations/local-preview.md`

- `up.sh`: `supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,studio,postgres-meta` (fails loudly if Docker is down); `supabase db reset --local` (never `--linked`); read `supabase status -o env`; write `.env.demo.local` with `VITE_SUPABASE_URL=http://127.0.0.1:54421` + local anon key + `VITE_DEMO=1`; run `node scripts/preview/seed.ts`.
- `seed.ts`: refuses unless the API URL is local; creates the two demo users through `POST /auth/v1/admin/users` with the local service-role key (email confirmed); signs in as each; fresh user: nothing else; story user: `runExistingMoneyStory`.
- Tour panel (demo mode only): the ten demonstrations, each with two sentences and a "Show me" link to the screen/item/entry.
- Doc: how to start, stop, reset; what is local; how to sign in.

- [ ] Implement, run `pnpm preview:up`, open `http://127.0.0.1:5173`, commit `feat(preview): add the seeded local preview and guided tour`.

## Task 13: End-to-end against the local stack

**Files:** `e2e/flows.spec.ts`, `e2e/support.ts`, `playwright.config.ts`

- Config: baseURL `http://127.0.0.1:5173`, webServer `pnpm demo`, projects desktop 1440×1000 and mobile 390×844, requires the local stack (test skips with a clear message if `127.0.0.1:54421` is down — reported as unverified, never as passed).
- Specs: (1) sign up a new random user → onboarding with $4,110 → add Bank 0 → record income 4,110 → Fund my plan → Home shows Ready to assign $0.00 and Set aside $4,110.00; (2) record groceries over the item → cover message → Home identity holds; (3) move $150 General savings → Holiday; (4) story user: pay the Internet bill from Home; (5) contribute to investments; (6) Arabic: switch language, Home renders RTL with no horizontal scroll at 390px.

- [ ] Implement, run, commit `test(e2e): cover the everyday flow against the local stack`.

## Task 14: Docs, decisions, final verification

- [ ] `docs/design-guidelines.md`: record any new `cr-*` classes.
- [ ] `docs/decisions.md`: entries for the eleven spec decisions + execution deviations.
- [ ] `README.md`: v2 concepts, run/preview/test commands.
- [ ] `docs/verification/2026-10-03-connected-money-model.md`: commands run with results.
- [ ] Full gate: `pnpm typecheck && pnpm test:db && pnpm test:ui && pnpm build && pnpm test:e2e`.
- [ ] Final whole-branch review (fresh reviewer), fix findings, commit.
