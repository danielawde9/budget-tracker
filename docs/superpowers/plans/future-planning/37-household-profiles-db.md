# 37 — Member display and wallet ownership labels

**Layer:** DB. **Depends on:** 03; current household membership commands. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## New tables, authorisation and APIs

Create `_household_display_profiles.sql`,
`tests/db/household-display.integration.test.ts`.
`member_display_revisions`: id bigint identity,space_id,user_id UUIDs,
name_en/name_ar nullable1…80 at least one,expected_revision_id nullable,
request_id,actor_id,created_at. Stream(space,user); immutable revisions. Composite
membership FK where current schema supports it; otherwise FKusers plus deferred
same-space membership existence (historical membership may be deactivated, not
required active forever). Self-only editing; spaceowner may not impersonate a
member. No birthdate, email, phone, authmetadata copy or public avatarURL.

`wallet_ownership_revisions`: id bigint identity,space_id,wallet_id UUID,
ownership shared/member,member_user_id nullable UUID,expected_revision_id nullable,
audit. CHECK shared iff member NULL; member label requires currently active member
at command time; retained historical labels show former member. Samewalletstream,
standard guards,FKs,head constraints/indexes. Owner-only label editing by default;
ordinarymember may read because all household wallets already visible. Labels
are **presentation only**; selecting Mine does not make another wallet private.

`set_member_display(p_space_id uuid,p_request_id uuid,p_user_id uuid,p_name_en text,
p_name_ar text,p_expected_revision_id bigint)` →{revisionId}.
`set_wallet_ownership(p_space_id uuid,p_request_id uuid,p_wallet_id uuid,
p_ownership text,p_member_user_id uuid,p_expected_revision_id bigint)` →{revisionId}.
`household_display_page(p_space_id uuid,p_after_user_id uuid,p_limit int)` →
{rows,hasMore,nextCursor}; rowuserId,nameEn,nameAr,state active/former,revisionId.
Only currentmembers can read; fallback Member/former member, never private email.
Do not expose private-space membership through household profile lookup.

`household_activity_page(p_space_id uuid,p_before_created_at timestamptz,
p_before_id uuid,p_limit int)` →{rows,hasMore,nextCursor}; event rowid,createdAt,
effectiveDate,actorId,actorNameEn,actorNameAr,actorState,kind,movements≤20.
Complete keyset createdAt/id; limit1…100; authorize household membership before
query, returned projection never browser auth.users reads. Current display label
for historical actor, explicitly described; immutable event actor never changes.

Tests self edit vsothermember, owner label versus normal member, removed member cannot read,
former actor fallback, no auth metadata inJSON, private space cross-query, null partial
cursor, duplicate-head race, same requestafter removaldenied, labels cash digest unchanged.

## Verification and stopping point

Write the listed rejection/acceptance tests before implementation. DB tasks use
new timestamped forward migrations under `supabase/migrations/` and real disposable
PostgreSQL fixtures from 01; update `docs/financial-command-inventory.md` when RPCs
change. Run the listed focused tests, then env-loaded `pnpm check` for DB changes.
Do not relabel synthetic browser tests as authenticated live-product evidence.

Record actual commands/results in `docs/verification/future-planning/<file-id>.md`,
append decisions (including what changes with a different owner answer), inspect
`git diff --check` and staged scope, then make a conventional commit naming this
feature/layer. Stop here; do not execute the downstream layer or deploy/push.
