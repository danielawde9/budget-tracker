# 47 — Pay-cycle gateway

**Layer:** gateway/hooks. **Depends on:** 46,07 shared transport. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

Create `src/features/pay-cycles/types.ts`, `supabase-pay-cycles-gateway.ts`,
`use-pay-cycles.ts` andtests plus in-memory fake. Methods preview,save,load map
exact46RPCfields; sourceKind discriminated root/goal/debt/headroom/carry, typedsourceIDs
accordingto contract, notanyJSON. Validate ordinal1…10,ISOdate,complete assignment
caps and canonical money. Copy deterministic largest-remainder core from 07 for
preview only; server preview/hash is authoritative onsave.

Hook separates dirty assignment draft from saved revision. Changingmonth/space aborts
oldreads anddiscardlate generation. Explicitrecalculate loads new preview and
shows assignment differences; never silently overwrites dirty edits. SaveusesonerequestUUID,
expected revision and accepted preview hash; timeout receipt lookup before retry.
DTOstates no_plan/ready/stale_dependency/error; keep them separate fromtransport
saving/ambiguous/accepted-refresh-pending. No salary posting inthisgateway.
Tests 1001→334/334/333,cycle line conservation,changed source hash,unknown source ID,
unsafe bigint number,late space switch andaccepted-save-refreshfailure.
Runfocused UI-configVitest src/features/pay-cycles.

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
