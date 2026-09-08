# Categories Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Categories v1 PostgreSQL foundation without changing existing uncategorized clients or implementing any Categories UI.

**Architecture:** One forward-only migration adds normalized space-owned category metadata, immutable event-category associations, protected lifecycle/reconciliation commands, and an atomic categorized posting seam around the existing journal. Real-Postgres tests exercise rejection, replay, concurrency, RLS, grants, history guards, migration compatibility, and balance reconstruction; the financial command inventory remains fail-closed.

**Tech Stack:** PostgreSQL 17, Supabase RLS/auth roles, PL/pgSQL, pgcrypto, TypeScript 7, node-postgres, Vitest 5.

---

## File map

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260908100000_categories_foundation.sql` | Category enum, normalization, tables, constraints, indexes, RLS, guards, lifecycle/reconciliation commands, categorized posting, legacy replay hardening, and reversal propagation. |
| `tests/db/categories.integration.test.ts` | Categories v1 real-Postgres acceptance and rejection matrix, including replay, concurrency, authorization, immutability, and reconstruction. |
| `tests/db/test-database.ts` | Typed category command/session helpers plus bounded catalog and privilege probes used by integration tests. |
| `tests/db/financial-boundary-coverage.integration.test.ts` | Fail-closed writer inventory and protected-history-table catalog ratchets. |
| `docs/financial-command-inventory.md` | Classify the categorized journal writer and state that category lifecycle commands are non-posting metadata commands. |
| `docs/decisions.md` | Record the accepted member-management, kind-scoped uniqueness, and no-seed defaults. |

### Task 1: Lock the approved scope and baseline

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/superpowers/plans/2026-09-08-categories-database-foundation-implementation-checklist.md`

- [x] **Step 1: Confirm the isolated base and preserve unrelated work**

Run `git rev-parse HEAD`, `git status --short --branch`, and `git worktree list --porcelain`. Expected: base `14bbf7c0730d78744b6188fe6e8e754590d574e4`; only pre-existing `.swarm/` is untracked.

- [x] **Step 2: Prove the Budget-only database boundary before mutation**

Check the marked `/home/lelabo/budget-supabase` directory, `project_id = "budget-supabase"`, active/enabled `budget-tailnet-firewall.service`, listeners only in the assigned `54420–54429` range, Budget-container restart policy `no`, and PostgreSQL identity `170006` / `7683090997378195493`. Never inspect or operate another project.

- [x] **Step 3: Run the complete pre-edit baseline**

Run `pnpm install --frozen-lockfile`, then source only the ignored `.env.test` and run `pnpm check`; run `CI=1 pnpm test:e2e`. Expected: install succeeds, 28 database tests pass, 107 UI tests pass, build succeeds, and 23 applicable Playwright scenarios pass with 23 intentional skips.

- [ ] **Step 4: Commit the decisions and this checklist**

Run `git add docs/decisions.md docs/superpowers/plans/2026-09-08-categories-database-foundation-implementation-checklist.md && git commit -m "docs: plan categories database foundation"`.

### Task 2: Specify normalization and category lifecycle at the database boundary

**Files:**
- Create: `tests/db/categories.integration.test.ts`
- Modify: `tests/db/test-database.ts`
- Create: `supabase/migrations/20260908100000_categories_foundation.sql`

- [ ] **Step 1: Write failing schema and normalization tests**

Add typed helpers for `create_category`, `archive_category`, `get_category_command_result`, member-visible reads, and privileged catalog probes. Test absent/empty/whitespace/over-120 names; EN-only, AR-only, and bilingual storage; NFKC/case/whitespace collisions; Arabic alef/yeh/teh-marbuta/tatweel/diacritic collisions; unrelated Arabic and cross-script distinctions; same-label other-kind/other-space acceptance; reuse after archive; no seeded rows. Run `pnpm test:db -- tests/db/categories.integration.test.ts`; expected RED because category objects/functions do not exist.

- [ ] **Step 2: Add minimal normalization and schema objects**

In the migration, add `public.category_kind`; immutable `private.canonical_category_name`, `private.english_category_key`, and `private.arabic_category_key` functions with fixed search paths; `public.categories`; and `public.category_command_requests`. Use generated stored keys, bounded checks, composite tenant keys/FKs, active per-language partial unique indexes keyed by `(space_id, kind, key)`, and no inserts outside commands.

- [ ] **Step 3: Add lifecycle security and commands**

Add indexed member SELECT RLS only, exact grants/revokes, owner-only effective-role write guards, category archive-only UPDATE guard, DELETE/TRUNCATE history guards, append-only request guards, advisory request serialization, versioned canonical JSON fingerprints with explicit nulls, stable safe conflict messages, and the bounded result lookup. Implement identical replay and changed-command/payload rejection.

- [ ] **Step 4: Verify lifecycle RED becomes GREEN in a disposable database**

Rebuild an explicitly named disposable database on the verified Budget PostgreSQL cluster from the committed migrations plus the in-progress migration; never apply a partial migration to the main Budget database. Point the test process at that disposable database through an ephemeral `BUDGET_TEST_DATABASE_URL`, run the focused normalization/lifecycle tests and `pnpm typecheck`, and expect all focused cases to pass without warnings. Keep the migration uncommitted until the entire coherent file is green.

### Task 3: Add immutable categorized financial posting

**Files:**
- Modify: `tests/db/categories.integration.test.ts`
- Modify: `tests/db/test-database.ts`
- Modify: `supabase/migrations/20260908100000_categories_foundation.sql`

- [ ] **Step 1: Write failing association and categorized-posting tests**

Test categorized income/expense wallet effects and one association; reject opening, transfer, loan event kinds, wrong-kind, archived, missing, and cross-space categories atomically; test identical and changed replay in both categorized-to-uncategorized directions; test concurrent identical categorized requests; and prove direct association writes fail. Run the focused file and confirm RED because the association/command is missing.

- [ ] **Step 2: Add the association and declarative guards**

Add `(financial_events.id, space_id, kind)` uniqueness; `public.financial_event_categories` with one row per event, composite event/category foreign keys, kind compatibility check, `(space_id, event_id)` and `(space_id, category_id, event_id)` indexes, member SELECT RLS, exact read-only grants, owner-only insert guard, and UPDATE/DELETE/TRUNCATE history guards. Add a reversal-validation trigger that accepts only an exact copy from `reversal_of`.

- [ ] **Step 3: Add categorized posting and cross-mode replay rejection**

Implement `public.record_categorized_financial_event(uuid, uuid, public.financial_event_kind, date, jsonb, uuid)` as SECURITY DEFINER with the same financial request lock. On replay, validate the legacy base fingerprint plus exact category association; on new posting, accept only active same-space matching categories under `FOR KEY SHARE`, delegate movement validation/posting to the unchanged-signature legacy command, then insert the association atomically. Replace only the legacy command body needed to reject uncategorized replay of a categorized request while preserving its five-argument signature and fingerprint algorithm.

- [ ] **Step 4: Verify categorized posting in the disposable database**

Rebuild the disposable database from the full journal and in-progress migration. Run focused category tests, all foundation and loan database tests, typecheck, direct-write/execute privilege probes, and `git diff --check`. Expected: new cases and all legacy cases pass; categorized failure leaves zero event/movement/association rows. Keep the migration uncommitted until reversal propagation and the catalog ratchet are also green.

### Task 4: Propagate categories through reversals

**Files:**
- Modify: `tests/db/categories.integration.test.ts`
- Modify: `supabase/migrations/20260908100000_categories_foundation.sql`

- [ ] **Step 1: Write failing reversal propagation tests**

Test categorized reversal before and after archive, exact copied association, immutable original/reversal facts, cancelling wallet balance, uncategorized reversal remaining uncategorized, caller categorization rejection, and unchanged dependent-loan reversal rejection. Confirm RED because existing reversals do not copy associations.

- [ ] **Step 2: Replace the reversal body without changing its contract**

Preserve `public.reverse_financial_event(uuid, uuid, uuid, date)`, legacy fingerprinting, wallet/loan checks, and existing grants. After creating the reversal and linked wallet/loan postings, copy any original category association atomically regardless of archive state; let the association trigger prove exact inheritance.

- [ ] **Step 3: Verify reversal behavior in the disposable database**

Rebuild the disposable database and run focused category tests plus foundation and loans suites. Confirm balances reconstruct from immutable movements before/after reversals and all loan-aware rules remain green. Do not apply the still-changing migration to the main Budget database.

### Task 5: Ratchet catalog coverage, bounded reads, and migration safety

**Files:**
- Modify: `tests/db/financial-boundary-coverage.integration.test.ts`
- Modify: `tests/db/test-database.ts`
- Modify: `tests/db/categories.integration.test.ts`
- Modify: `docs/financial-command-inventory.md`

- [ ] **Step 1: Write failing fail-closed catalog tests**

Require `record_categorized_financial_event` in discovered journal writers and the inventory. Include `financial_event_categories`, `categories`, and `category_command_requests` in role privilege probes; verify fixed search paths, PUBLIC execute revocation, exact authenticated signatures, table RLS/policies, triggers, and ownership. Confirm RED before updating the inventory/ratchet.

- [ ] **Step 2: Add bounded/index-plan probes**

Test active category keyset reads with default 50 and hard cap 100, reconciliation returning at most one row, and journal-category resolution constrained to 20 event IDs. Seed representative rows, run `VACUUM ANALYZE`, and assert realistic plans use active-list, request-key, event, and category-history indexes for selective probes without forcing planner settings.

- [ ] **Step 3: Update the command inventory and make the ratchet GREEN**

Classify `public.record_categorized_financial_event` as the categorized income/expense writer. State that `create_category` and `archive_category` are metadata commands, the safe lookup is read-only, existing Wallets remains uncategorized, and no category UI entry path exists. Rebuild the disposable database, run the catalog and full database suites, and commit the now-coherent migration, tests, helpers, and inventory as `feat: add categories database foundation`.

- [ ] **Step 4: Prove empty and seeded-upgrade migration paths**

Create disposable databases only on the verified Budget PostgreSQL cluster. In one, apply all migrations from empty. In another, apply through `20260907149000`, seed Budget-only spaces/wallets/events/movements/loans/reversals/targets and snapshot event IDs, fingerprints, movements, loan postings, balances, reversals, grants, and member-visible results; apply only `20260908100000`; compare snapshots and confirm zero seeded/backfilled categories. Drop only the explicitly named disposable databases after evidence is captured.

- [ ] **Step 5: Apply the finalized migration once to Budget development**

Repeat the remote directory/project/firewall/port/database-identity preflight, synchronize only the repository `supabase/` directory, and run `supabase migration up --local` from `/home/lelabo/budget-supabase`. Verify the journal advances from `20260907149000` to `20260908100000`; never edit the applied migration afterward.

### Task 6: Final verification and handoff

**Files:**
- Verify only; no UI or adjacent milestone files may change.

- [ ] **Step 1: Run the complete evidence set**

Run `pnpm install --frozen-lockfile`; `pnpm typecheck`; env-loaded `pnpm test:db`; `pnpm test:ui`; `pnpm build`; `CI=1 pnpm test:e2e`; source scans for direct `.insert()/.update()/.delete()/.upsert()` browser writes and protected RPC allowlists; SQL catalog privilege/function/trigger/policy checks; and `git diff --check`.

- [ ] **Step 2: Audit scope and commits**

Run `git diff 14bbf7c --stat`, `git diff 14bbf7c --name-only`, `git status --short`, and `git log --oneline 14bbf7c..HEAD`. Expected: only the migration, database tests/helpers, inventory, decisions, and this plan changed; `.swarm/` remains untouched and untracked.

- [ ] **Step 3: Report exact evidence without overclaiming**

Report install result, baseline and final counts, typecheck/build/UI/Playwright results, direct-write and protected-command scans, empty/upgrade migration proof, SQL permission/object scope, status, and every commit ID. State explicitly that Categories UI, budgeting, reporting, deployment, hosted operation, and whole-application completion are not claimed.

## Self-review

- **Spec coverage:** Tasks cover names/normalization, lifecycle, member authorization, idempotency/concurrency, immutable associations, categorized posting, legacy compatibility, reversal inheritance, RLS/grants/guards, catalog ratchets, bounded reads, indexes, and empty/seeded migration evidence.
- **Scope coverage:** No task adds UI, category splits/amounts, hierarchy, relabeling, post-hoc categorization, budgets, or reports.
- **Placeholder scan:** The checklist contains no deferred implementation placeholders; each behavior names its file, command, and expected state.
- **Type consistency:** `CategoryKind`, category command inputs/results, existing `FinancialEventKind`, and exact SQL signatures are consistent across helper, test, migration, and inventory tasks.
