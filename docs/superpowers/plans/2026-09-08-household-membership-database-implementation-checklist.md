# Household Membership Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved household invitation and membership lifecycle as a protected, auditable, idempotent PostgreSQL boundary without changing financial command bodies, browser gateways, email delivery, or UI.

**Architecture:** Forward-only migrations extend `space_memberships`, add a private invitation keyring, public invitation/current-state tables, immutable membership events, deferred cross-row invariants, six protected mutation commands, and two bounded owner projections. Real-Postgres tests exercise explicit JWT sessions, exact grants, RLS, safe token/email handling, replay, races on independent connections, and empty/seeded migration paths. The existing `private.is_active_member(uuid)` signature is preserved and strengthened so revoked or left users fail closed across every current caller.

**Tech Stack:** PostgreSQL 17/Supabase, SQL migrations, pgcrypto, TypeScript strict, node-postgres, Vitest, pnpm.

---

## File boundary

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260908170000_household_membership_schema.sql` | Membership lifecycle columns, invitation/event types and tables, keyring, indexes, dedicated owner, RLS, active-member/owner helpers, deferred invariants, immutable-event guards, and least-privilege grants. |
| `supabase/migrations/20260908171000_household_invitation_creation.sql` | Versioned identity/token helpers plus protected creation with receipts, deterministic replay, stable failures, and canonical locking. |
| `supabase/migrations/20260908171100_household_invitation_auth_boundary.sql` | Forward-only correction that keeps the dedicated owner out of `auth` while routing actor and active-recipient checks through private definers. |
| `supabase/migrations/20260908172000_household_invitation_consumption.sql` | Protected invitation acceptance/cancellation, one-time consumption, reactivation, and terminal-state races. |
| `supabase/migrations/20260908173000_household_member_commands.sql` | Promote/demote, remove, leave, bounded owner reads, and final exact function/table ACL ratchets. |
| `supabase/migrations/20260908173100_qualify_household_owner_counts.sql` | Forward-only qualification fix for PL/pgSQL output-name shadowing discovered by the role/removal/leave tests. |
| `tests/db/household-membership.integration.test.ts` | Full capability, lifecycle, token/privacy, idempotency, concurrency, atomicity, bounded-read, index, invariant, immutability, owner, and catalog proof. |
| `tests/db/test-database.ts` | Reusable authenticated/anonymous/admin sessions, invitation command adapters, independent barrier-backed clients, and catalog/test-defense helpers. |
| `tests/db/financial-boundary-coverage.integration.test.ts` | Regression assertion that household administration is not discovered as a financial writer and financial command inventory remains complete. |
| `tests/db/household-migrations.integration.test.ts` | Disposable-database empty-journal and seeded pre-membership upgrade proof, including preserved roles and timestamps. |
| `docs/decisions.md` | Append-only implementation decision for the protected stateful invitation and membership boundary and documented change consequences. |

`docs/financial-command-inventory.md` remains unchanged unless a test exposes an inaccurate statement: household administration is not a money/principal posting path and must not be classified as one.

## Task 1: Establish the isolated baseline and plan

- [x] Confirm the worktree is detached at current `main` (`14bbf7c`) and the Categories implementation is isolated in another worktree.
- [x] Preserve pre-existing untracked `.swarm/` files and confirm no tracked diff exists.
- [x] Source only `/Users/daniel/Desktop/Daniel/budget-tracking/.env.test` for database commands; do not print it, copy it, or access any non-Budget database.
- [x] Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:db`, `pnpm test:ui`, `pnpm build`, and `pnpm test:e2e` before editing.
- [ ] Commit this checklist with `docs: plan household membership database foundation`.

## Task 2: Add lifecycle schema, invariants, and defense layers test-first

- [ ] Add failing catalog and rejection tests for the exact enum values, named checks, FK actions, required indexes, dedicated non-login owner, forced RLS, no application/background writes, private-key inaccessibility, event immutability, and the three exact deferred constraint triggers.
- [ ] Add failing behavior tests proving existing memberships are backfilled to `active`, `activated_at = created_at`, inactive memberships lose existing space/financial access, self-only membership reads remain intact, and personal spaces reject every forbidden membership/invitation shape without an audit event.
- [ ] Run only the new schema-focused tests and record the expected missing-type/table/column failures.
- [ ] Create `20260908170000_household_membership_schema.sql` with:
  - `membership_status` and `household_invitation_status` enums;
  - lifecycle columns and the three required membership checks;
  - the private versioned 32-byte HMAC keyring with one active-key partial unique index and migration-generated keys;
  - invitation and membership-event tables with all required named checks/FKs/uniqueness and only the specified indexes;
  - `private.is_active_member(uuid)` replaced in place and `private.is_active_owner(uuid)` added with fixed search paths;
  - a dedicated `NOLOGIN NOINHERIT` command owner, forced RLS, owner-only policies, and exact table privileges;
  - immutable event row/statement triggers and deferred space/member/invitation invariant triggers;
  - explicit revokes from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- [ ] Apply only this forward migration to the Budget test database through the `.env.test` connection, rerun the focused tests, and keep the complete existing database suite green.
- [ ] Append the database-boundary decision to `docs/decisions.md` in the same green commit.
- [ ] Commit with `feat(db): add household membership security schema`.

## Task 3: Implement invitation creation test-first

- [ ] Add failing tests for owner-only household creation; personal-space rejection; blank, control/whitespace, malformed-`@`, and >254-byte email rejection; self/already-active recipient rejection; one live invitation per normalized identity; seven-day expiry; no plaintext identity/token storage; deterministic exact replay; and changed-input request conflicts.
- [ ] Add a real two-connection barrier test proving identical concurrent creates return the same invitation ID/token/expiry and create one row/event, plus races for changed payload and two request IDs targeting one identity.
- [ ] Verify RED because `create_household_invitation(uuid,uuid,text)` does not exist.
- [ ] Create `20260908171000_household_invitation_creation.sql` with private normalization, versioned HMAC, SHA-256, fingerprint, deterministic base64url token, actor/request advisory-lock, recipient advisory-lock, and receipt helpers. Implement `create_household_invitation` with space-row locking, active-owner/household validation, canonical errors, atomic invitation/event insertion, and exact replay.
- [ ] Revoke every helper and public signature first, then grant only the exact create signature to `authenticated`; verify owner and ACL from catalogs.
- [ ] Apply the forward migration through `.env.test`, rerun the focused creation/race tests, then the full database suite.
- [ ] Commit with `feat(db): add protected household invitations`.

## Task 4: Implement acceptance and cancellation test-first

- [ ] Add failing tests for confirmed-email acceptance into a new membership and reactivation of revoked/left rows as `member`, preserving prior events.
- [ ] Add one assertion table proving malformed, unknown, expired, cancelled, consumed, and wrong-confirmed-email tokens share the same public SQLSTATE/message; add unconfirmed-email and anonymous rejection tests.
- [ ] Prove exact acceptance replay, different-request token reuse rejection, post-removal/post-leave replay non-reactivation, cancellation of pending/expired invitations, and rejection of cancelling accepted invitations without membership mutation.
- [ ] Add barrier-backed races for identical acceptance, different requests on one token, and acceptance versus cancellation; assert terminal state, membership, and one matching event rather than timing.
- [ ] Verify RED because accept/cancel signatures do not exist.
- [ ] Create `20260908172000_household_invitation_consumption.sql` with `accept_household_invitation` and `cancel_household_invitation`, following advisory → space → invitation → membership lock order and revalidating after locks. Store no raw token/email and return only the approved safe shapes.
- [ ] Add deterministic forced-failure test hooks scoped to the test transaction so failures between invitation/membership/event writes roll back all related state; expose no hook to application roles.
- [ ] Apply once, rerun focused lifecycle/atomicity/race tests and the full database suite, then commit with `feat(db): protect household invitation consumption`.

## Task 5: Implement member administration and bounded reads test-first

- [ ] Add failing tests for promotion, demotion, remove, and leave; role no-op; inactive/cross-space/invented target; self-removal prohibition; reactivation only through a newly issued invitation; and no financial-row mutation.
- [ ] Add command and deferred-invariant tests for the last owner, including deliberately weakened test privilege/RLS paths.
- [ ] Add independent-connection races among leave, removal, and demotion affecting the final two owners; assert no deadlock and at least one active owner.
- [ ] Add failing bounded-read tests for owner/member/anonymous/unrelated/inactive access, limits 0/101, 100-row cap, stable keyset pages, effective expiry, and absence of email/digest/token/free-text columns.
- [ ] Create `20260908173000_household_member_commands.sql` implementing `set_household_member_role`, `remove_household_member`, `leave_household_space`, `list_household_members`, and `list_household_invitations` with exact signatures, canonical space locking, active-owner checks, event receipts/fingerprints, `1..100` limits, and keyset predicates.
- [ ] Revoke all function execution before granting only the six mutation and two read signatures to `authenticated`; retain no direct invitation/event reads for clients.
- [ ] Apply through `.env.test`, run focused tests, `VACUUM ANALYZE`, and selective `EXPLAIN` probes confirming the intended partial membership and invitation indexes.
- [ ] Commit with `feat(db): protect household member administration`.

## Task 6: Prove migration paths and ratchets

- [ ] Add a disposable-database harness with a bounded connection timeout and unique generated database names. Bootstrap only the Supabase roles, `auth.users`, and trusted `extensions` schema required by the journal; always terminate its own connections and drop only its exact generated database in `finally`.
- [ ] Empty proof: apply every committed migration in lexical order and assert the migration objects, active key, exact function owners/ACLs, constraints, policies, and triggers exist.
- [ ] Seeded proof: apply through `20260907149000`, create personal/household owners plus representative wallet/event/movement/loan state, record membership roles/timestamps and amounts, apply the three household migrations, then prove lifecycle backfill and all financial rows remain byte-for-byte/amount-equivalent.
- [ ] Add a source ratchet that scans browser gateway files for direct membership/invitation `.insert()`, `.update()`, `.delete()`, `.upsert()`, or `.truncate()` calls and token/session logging. It must pass without editing application code.
- [ ] Extend financial boundary coverage only with assertions: household commands must not match financial-table writer discovery, and the financial inventory must remain unchanged and complete.
- [ ] Run the migration suite twice to prove cleanup and rerun safety, then run the complete database suite.
- [ ] Commit with `test(db): prove household migration and security boundaries`.

## Task 7: Final verification and scope audit

- [ ] Run fresh: `pnpm install --frozen-lockfile`.
- [ ] Run fresh: `pnpm typecheck`.
- [ ] Source the approved `.env.test` and run fresh: `pnpm test:db`.
- [ ] Run fresh regressions: `pnpm test:ui`, `pnpm build`, and `pnpm test:e2e`.
- [ ] Run `git diff --check`, direct-write/token/email scans, catalog/grant queries, constraint/index inventory queries, and migration empty/seeded proof.
- [ ] Compare every pre-existing migration and every existing financial command body/ACL against `14bbf7c`; only the five planned Household migrations plus any evidence-driven forward correction may differ under `supabase/migrations/`.
- [ ] Inspect staged scope before each commit and final `git status --short`; preserve `.swarm/` and any unrelated user files.
- [ ] Report exact database/UI/E2E counts, catalog/grant evidence, migration proof, commits, diff/status, blockers, and explicitly state that gateway/application behavior, email provider/DNS/templates/sending, and UI remain unimplemented.
- [ ] Do not push, deploy, merge, provision, reset any non-Budget service, or send an external message.

## Self-review

- [x] Spec coverage: data model, personal prohibition, active helper, six commands, two bounded reads, HMAC/token minimization, idempotency, locking, RLS, ACLs, last-owner, audit immutability, atomicity, concurrency, index plans, and both migration paths each map to a task.
- [x] Placeholder scan: the plan contains no `TBD`, deferred implementation placeholder, or unspecified test/fix step.
- [x] Type/signature consistency: names and signatures match the approved design; household administration remains outside the financial writer inventory.
