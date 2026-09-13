# 39 — Household check-in, insight cards and privacy display

**Layer:** UI. **Depends on:** 38;17;41 for persisted review state. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Owned files and independent slices

Create selected components in `src/features/household-display/` with tests and
`e2e/household-display.spec.ts`. Slice39a profiles/activity/ownership;39b weekly
check-in/insights;39c hide amounts. Existing invitation sending stays in its
Worker flow and requires an actual user send action; no email in display queries.

39a: editable own displayname, owner-managed walletlabels, actor chips and
paginated activity. Mine/Theirs/Shared/Unlabelled filters visibly say all household
members retain access. A removed actor displays Former member if no chosenlabel.
No membership mutation attached to a presentation filter.

39b: weekly checklist from exact report facts: uncategorized count>0,
anygroup actual>target, overdue unpaid bills, goals shortage>0. Show source amount,
period and drilldown; acknowledge only selected stable issue key/revision via41.
New/changed fact revision reappears. No autonomous recategorization. Pure predicates
in `insight-rules.ts` with test table: overspend iffactual>effective capacity;
shortage if goal shortage>0; fixed bill is never compared against uniformdaypace.
Optional spendingpace insight only for explicitly discretionary group and at least
7elapsed days; compare actual*monthDays>target*elapsedDays with BigInt. Label an
estimate; no implication every month repeats past spending. Max 5cards, deterministic
priority deficit→overdue→overspend→uncategorized→pace. Dismiss/restore retains facts.

39c: `amount-visibility.ts` per user/device local preferenceversion1, defaultvisible.
Apply mask to amounttext,chartlabels,tooltips,SVGtitle/desc,accessible names,exports
preview and tabtitle; keyboard toggle announced without leaking amount. Masking
never changes permissions or prevents explicit authenticated export download after
review. No raw value as CSScontent/dataattr for hidden tooltip; do not claim it
protects developer tools or an authorised DOM read. Test DOM text and aria labels
for fixtureamounts whilehidden. Persist preference only, no financial records.

All slices have EN/AR/RTL,keyboard,320/390/768/1440 and200%zoom tests. Avoid exporting
sensitive profile names in screenshots; synthetic member fixtures only.

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
