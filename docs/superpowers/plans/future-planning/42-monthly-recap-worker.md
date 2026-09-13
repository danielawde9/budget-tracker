# 42 — Opt-in monthly recap delivery worker

**Layer:** Worker/API. **Depends on:** 49; existing invitation Worker mail boundary. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Readiness and scope

This task implements a reviewable, disabled-by-default delivery boundary; executing
it does not authorize a real send. First inspect existing Worker invitation service,
env schema, provider adapter and tests under `src/worker` or the actual current
Worker entry path (locate with `rg --files | rg worker`). Reuse that auth/provider
interface; do not invent an unconfigured provider. If it has no mail capability,
complete deterministic content and fake adapter tests, name missing provider configuration.

Owned new files `worker/monthly-recap.ts`, `worker/monthly-recap.test.ts` only if
worker is actual root; otherwise use verified Worker source directory and record
path mapping in evidence before edits. Prefer `tests/worker/monthly-recap.test.ts`
for suite discovery. No database migration in this Worker task; prerequisite DB
subtasktask49 must be executed as a separate session first.

## Database prerequisite

Execute [49-recap-delivery-db.md](49-recap-delivery-db.md) in its own DB task
first. Its real-engine evidence is required before Worker delivery integration.
Do not add or modify queue SQL as part of this Worker task.

## Worker algorithm and content

Generate a minimal recap from exact month read DTOs: received income,ordinary
spending,signed surplus,top3overspentgroups,goal progress. One currency section each;
no private-space merge, no loan person names/notes or transaction items by default.
Render EN/AR escaped plain text and HTML; subject never includes amounts.
Explicit preview endpoint returns content to signed-in member; explicit enqueue
is separate from preference editing. A future scheduled invocation needs its own
user request/configuration; noautomation installed by this document.

For each bounded job: reauthorize member/optin, generate/verify content digest,
call provider with stable job idempotency key and10secondtimeout, persist provider ID
and outcome. If provider has no idempotency/statuslookup, ambiguous timeout stays
needs_review and is **not automatically resent**; use the needs_review state from 49.
No exactly-once external delivery claim from an internal UNIQUE alone.3attempts
only for confirmed retryable failures, never an ambiguous send. LogjobID/decision,
not recipient address/content/token. Use existing secret binding, no service key in the browser.

Tests fake provider success/rejection/timeout after acceptance, duplicate scheduler,
opt-out between enqueue and send, missing member, bilingual escaping and currency separation.
Real provider smoke-send remains Not run until explicitly requested.

## Verification and stopping point

Write the listed rejection/acceptance tests before implementation. DB tasks use
new timestamped forward migrations under `supabase/migrations/` and real disposable
PostgreSQL fixtures from 01; update `docs/financial-command-inventory.md` when RPCs
change. Run the listed focused tests, then env-loaded `pnpm check` for DB changes.
Gateway/UI tasks run focused UI-config Vitest, `pnpm typecheck`, `pnpm test:ui`,
`pnpm build`; UI additionally runs its named Playwright spec and `pnpm test:e2e`.
Worker tasks run focused worker tests, `pnpm test:worker`, typecheck and build.
Do not relabel synthetic browser tests as authenticated live-product evidence.

Record actual commands/results in `docs/verification/future-planning/<file-id>.md`,
append decisions (including what changes with a different owner answer), inspect
`git diff --check` and staged scope, then make a conventional commit naming this
feature/layer. Stop here; do not execute the downstream layer or deploy/push.
