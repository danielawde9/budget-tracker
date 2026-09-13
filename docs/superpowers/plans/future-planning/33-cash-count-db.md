# 33 — Physical cash count and adjustment

**Layer:** DB. **Depends on:** 27. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Schema and commands

Create `_cash_reconciliation.sql`, `tests/db/cash-reconciliation.integration.test.ts`.
`cash_count_sessions`: id uuid PK,space_id,wallet_id,currency,expected_minor
numeric(30,0),observed_minor bigint0…999999999999999,movement_digest bytea (32 bytes),
counted_on date,request_id,actor_id,created_at; immutable. Composite tenantwalletFK.
`cash_count_confirmations`: session_id uuid PK/FK,space_id,event_id uuid nullable
same-space FK,confirmed_at DEFAULT now(),actor_id,request_id; exact-one confirmation.
Zero difference records confirmation without a zero-movement financial event.

`preview_cash_count(p_space_id uuid,p_wallet_id uuid,p_observed_minor text)` →
{expectedMinor,observedMinor,differenceMinor,movementHead,countedOn}.
`record_cash_count(p_space_id uuid,p_request_id uuid,p_wallet_id uuid,
p_observed_minor text,p_expected_movement_head text)` → {sessionId,differenceMinor}.
`confirm_cash_count(p_space_id uuid,p_request_id uuid,p_session_id uuid)` →
{sessionId,eventId nullable,differenceMinor}. No editable balance field.

Head is digest of complete wallet movement identities/amounts plus wallet lifecycle
revision at current read; cap100000 per-wallet facts for preview and explicit cap
error, never partial balance. Confirmation obtains wallet FOR UPDATE **before**
rechecking head/balance. Current require_active_movement_wallet trigger takes FOR
SHARE, which conflicts; verify all movement-writing paths still execute it.
A concurrent ordinary posting either precedes fresh head check or waits and posts
after adjustment; stale head rejects count. Recount creates a new session rather
than replacing the observed count. CountDate=today, audit server now.

For nonzero diff add cash_adjustment kind: one movement difference, immutable
session linkage. Individual difference must fit existing15digit bounds; otherwise
reject and require an explicitly scoped accounting repair, never chunk silently.
Reverse negates adjustment and leaves count history. Adjustment is neither salary
nor ordinary expense and does not consume a category target. Category NULL.

Tests ledger10000/observed9800→adjustment−200; equal→no event; reverse restores10000.
Two competing counts/head, posting before/after lock, archive race, negative observed,
foreign wallet, replay after later posting, zero-rowdelete/truncate/ACL. Explicitly
prove FOR SHARE writer conflict with two clients; do not rely on a mock head token.

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
