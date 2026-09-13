# 35 — Financial extensions gateway slices

**Layer:** gateway/hooks. **Depends on:** the selected28…34 DB task; task 07 transport. Execute only this layer.
Read [00-start-here.md](00-start-here.md), [01-sql-contract.md](01-sql-contract.md)
and [01-test-recipes.md](01-test-recipes.md). Recheck source before adding objects.
All proposed amounts/rates in fixtures are synthetic, not current market rates.

## Select one completed SQL feature

Create `src/features/money-extensions/types.ts`, `supabase-money-extensions-gateway.ts`,
`use-money-extension-command.ts`, `errors.ts`, matching tests and
`src/test/in-memory-money-extensions-gateway.ts`. Extend these only for the selected
feature, preserving already-verified methods. No new financial SQL or UI.

| Slice / method | RPC | Input mapping after spaceId,requestId |
| --- | --- | --- |
| exchange | record_currency_exchange | fromWalletId,toWalletId,fromAmountMinor,toAmountMinor,effectiveDate |
| mixedPurchase | record_mixed_currency_purchase | usdWalletId,lbpWalletId,tenderUsdMinor,expenseUsdMinor,changeLbpMinor,effectiveDate,categoryId |
| repayFx | record_cross_currency_repayment | loanId,walletId,loanAmountMinor,cashAmountMinor,effectiveDate |
| quoteRate | record_reference_rate | fromCurrency,toCurrency,fromMinor,toMinor,quoteDate,sourceLabel,expectedQuoteId |
| previewCashCount | preview_cash_count | walletId,observedMinor (read: no requestId) |
| recordCashCount | record_cash_count | walletId,observedMinor,expectedMovementHead |
| confirmCashCount | confirm_cash_count | sessionId |
| splitExpense | record_split_expense | walletId,amountMinor,effectiveDate,lines |
| refund | record_expense_refund | originalEventId,walletId,amountMinor,effectiveDate,lines,goalRefunds |
| forgive | forgive_loan_principal | loanId,amountText,effectiveDate,reason |

Map camelCase→p_snake_case explicitly, matching actual installed SQL signatures
in the selected task's evidence. Parse TABLE responses as exactly one checked
UUID row, JSON responses using the exact named fields; never assume all functions
return the same wrapper. Add typed quote/due/people read methods only with their
matching DB evidence. Use task 07 canonical integer parsers; division/rates stay
BigInt rational. Client preview never replaces server totals or outstanding checks.

Money commands have journal request IDs, not necessarily planning receipts.
Add protected `find_financial_command(p_space_id uuid,p_request_id uuid)` during
27/selectedDB task if no current approved equivalent exists. Return only actor-owned
accepted event UUID/kind; removed member denies, missing returnsnull. That read must
be DB-tested **before** this gateway task. Cash/quote metadata use planning receipts.
Timeout looks up the correct receipt type then refreshes; never resend with new UUID.

Hook states idle/editing/submitting/accepted-refresh-pending/ambiguous/error.
Freeze submitted payload and UUID; one user confirmation→one request identity.
Accepted-but-refresh-failed keeps acceptance banner and disables duplicate submit.
Stale cash head reloads preview and requires another reviewed count. Refund
allocation cap errors attach to the correct original line/goal link.

Tests for each slice use exact numerical fixtures in its DB plan, wrong wrapper,
unsafe JSnumber, missingUUID, timeout after commit, lifecycle change after acceptance,
late space switch response, partial currency mismatches and mapped error tokens.
Run `pnpm exec vitest run --config vitest.ui.config.ts src/features/money-extensions`.

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

## Additional32a/32b read and metadata methods

Implement only with their matching DB evidence: createPerson(spaceId,requestId,
personId,nameEn,nameAr); linkPerson(spaceId,requestId,loanId,personId,
expectedRevisionId); loadDue(spaceId,currency,asOfDate,afterDueIsNull,afterDueDate,
afterId,limit); personSummary(spaceId,personId,currency); saveInstalments(spaceId,
requestId,loanId,expectedRevisionId,lines). Map to32 named RPCs, preserving complete
nullable-date cursor. The DB task must freeze these public signatures with `p_`
argument names and return JSON fields before the gateway begins. No fallback to
querying auth tables or merging people by label.

Reference-rate read: `loadReferenceRate(spaceId,fromCurrency,toCurrency,asOfDate)`
maps to30's `reference_rate_at` with exact p_ parameter names and nullable missing
quote fields. Quote creation uses planning receipts; it never uses journal lookup.
