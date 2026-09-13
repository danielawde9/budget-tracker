# 38 — Household attribution gateway

**Layer:** gateway/hooks. **Depends on:** 37;41 for review methods. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Owned files and implementation

Create `src/features/household-display/types.ts`,
`supabase-household-display-gateway.ts`, `use-household-display.ts` and tests;
add `src/test/in-memory-household-display-gateway.ts`. Existing household mutation
boundary stays unchanged. New explicit methods setMemberDisplay,setWalletOwnership,
listDisplayMembers,listActivity match37 signatures. Add review methods from 41 only
when41 evidence exists: saveReviewState,loadReviewState. Use task 07 shared parsers/
transport/receipt recovery with exact finite enums and complete cursor tuples.

Do not deduce a member's identity from a display label. UserUUID is identity;
former member remains distinguishable; same name does not merge users. Current
session identity comes from existing auth boundary. A Mine filter matches latest
wallet ownership memberUserId=current actor; Shared matches ownership shared; Theirs
matches other member IDs. Missing label is Unlabelled, never inferred from creator.
No filter changes RLS or hides data for security. Clearly typed displayFilter.

Test duplicate labels, removed member result, wrong tenant stale response, allowed
self edit/denied edit of another member response, cursor ties and no email field accepted inDTO.
Review metadata can fail independently of money data; don't mark transactions
reviewed or saved when its command fails. Command retries preserve UUID/payload.
Run focused UI-config Vitest under src/features/household-display.

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
