# Commented bill issues implementation plan

> For agentic workers: use superpowers:subagent-driven-development task by task, with spec and quality review.

Goal: resolve GitHub #7 and #8 and reply to the contributor only after verification.
Architecture: one append-only bill-payment link event table; entry birth links remain immutable. Shared helpers resolve current links, total cash payments and latest payment. Existing space/request locking serializes commands. Money lines are never changed by relinking.
Tech stack: Postgres/Supabase, React/TypeScript, Vitest, Playwright.

Existing owner-authored acceptance criteria: https://github.com/danielawde9/budget-tracker/issues/7 and /issues/8. User authorized fixing valid reports and replying/closing them.

- [x] Task 1: DB regression tests and additive migration. Test 20/60 then 40/60, reversal of either, overpayment, loan principal+interest+fees, remaining-only coverage, moving/detaching/relinking without any money rows, skipped/cross-item/currency/loan/reversed/nonmember refusals, replay and stale revision. Keep all original entries immutable and original migrations unchanged. Add API contract/privilege expectations.
- [x] Task 2: typed API + frontend. BillOccurrence adds remaining, overpaid and paymentCount, status part_paid. Bill intents default to remaining. Show paid/remaining/excess with Amount in EN/AR. Activity Entry adds billLinkVersion and billLinkHistory. Add move/detach UI limited to same item/currency/loan occurrence, using existing billsUpcoming. Keep Correct for cross-item cases. Hold modal pending state. Tests cover the exact RPC and amounts with no reversal call.
- [x] Task 3: independent spec review then code quality review. Repair findings and rerun affected tests.
- [x] Task 4: full DB/UI/build tests and real local demo end-to-end tests. Preserve previous mobile fixes in primary checkout. Commit issue changes on codex/fix-commented-bill-issues, push branch, create/attach PR, reply as authenticated owner with validation and qualification of contributor's replay claim, close issues only when fixes are concretely delivered and link code.

DB/frontend contract:
- public.move_bill_payment(p_space uuid,p_request uuid,p_entry uuid,p_expected_version integer,p_bill uuid DEFAULT NULL,p_due date DEFAULT NULL) -> {entryId,billId,dueOn,linkVersion}.
- bill occurrences: remaining=max(expected-paidAmount,0); overpaid=max(paidAmount-expected,0); paymentCount integer. A positive unpaid remainder is part_paid when there is a payment; skipped partials stay skipped until undo.
- entry JSON billId/billDueOn/billName resolve current association. billLinkVersion is 0 at birth, increments per link event. billLinkHistory array [{billId:uuid|null,billName:string|null,dueOn:date|null,createdAt:string}] describes moves/detaches, empty at birth. Reversals remain tied to original entry and exclude its active payment from whichever bill it currently belongs to.
- Error BUDGET_BILL_LINK_CHANGED for stale revision; BUDGET_BILL_MISMATCH for cross-item/currency/loan changes; existing paid/skipped/not-due/nonmember errors retained.

Verification: pnpm check passed (191 DB tests, 140 UI tests, typecheck/build); pnpm test:e2e:bills passed six real-local-DB flows (EN/AR × desktop/iPhone13/320px). Spec and quality reviews have no remaining important findings after fixes. The earlier mobile changes remain preserved in the primary checkout.

Published PR: https://github.com/danielawde9/budget-tracker/pull/10. Replies posted as danielawde9 to both contributor comments, and issues #7/#8 verified CLOSED/COMPLETED. Merge and migration-first production release remain pending and were explicitly disclosed in the PR and replies. The other seven open issues had no outside comments and were left for their separate scopes.

Completion update (06:01 UTC): PR #10 squash-merged as `a2e6445`; migration-first production release and frontend deployment verified. The owner subsequently authorized finishing the remaining issues; all nine issues are closed with replies. Combined validation: 202 DB, 160 UI and 60 browser tests. See `docs/operations/2026-10-08-issue-release.md` for release evidence and external limitations.
