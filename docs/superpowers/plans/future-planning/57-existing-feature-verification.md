# 57 — Verify existing notes, wallet lifecycle and invitations

**Layer:** verification; select one existing layer. **Depends on:** current source. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Source-present work must not be rebuilt

X1 notes/payees, X6 wallet rename/archive/restore, N3 invitation flow and parts of
X3 quick entry exist at the planning baseline. Select57aDB,57bGateway or 57cUI and
one feature; do not run broad repairs outside that selection. Start with
`git log --oneline -8`, source and exact current RPC/gateway signature comparison.

57a: existing `tests/db/wallet-lifecycle.integration.test.ts`, corresponding
metadata/category/household tests found via `rg --files tests/db`; env-load01,
run focused real engine tests. Cases: notes revision no cashchange, request replay,
wallet archive rejects nonzero balance, restore preserves ID/history, removed member
cannot mutate metadata, household invite auth/expiry. If failure, use systematic-
debugging and red test before forward-only scoped fix. No copied new tables.

57b: existing `src/features/wallets/supabase-wallets-gateway.test.ts`,
`use-wallets.test.tsx`, `quick-entry.test.ts` and household gateway tests.
Verify accepted mutation/failedrefresh distinction, immutable note edits via RPC,
repeat-as-new fresh UUID, stale category/wallet handling and exact money.
No runtime gateway edits merely because another plan proposes different names.

57c: existing wallet dialogs/journal and household invitation page tests plus
current Playwright specs discovered with `rg --files e2e`. Test keyboard/mobile/
RTL, cancellation, active/former actor, archive/restore list and invitation preview.
No real invitation sends during verification without an explicit user send request.
Record Source-present / Test-proven / Live-UAT / Deployed separately. If current
behavior already meets contract, evidence-only commit is the correct outcome.

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
