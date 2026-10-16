# Group money and opening balance safeguards

**Goal:** Expenses use the funded flexible balance of their own group before unassigned money. Opening forms accept the intended resulting balance, add only the difference, reject stale balances and preserve affordability checks. Publish without changing existing financial allocations; keep Goals money at $900 and leave over-assignment untouched at the user's latest instruction.

**Architecture:** Keep journal conservation and append-only history. For implicit expense cover, resolve the item's group for its effective date, take the safe available amount from that group's flexible item, then cover any remainder from unassigned. Explicit cover remains an override. Never consume another group's money automatically. Category openings remain backed assignments. Account openings require confirmation of previously missing money. Both use expected balances to reject stale inputs; receipts replay before validation.

**Implementation:**
- [x] Database regression tests and forward migration: automatic group cover (partial, currencies, backdates, explicit overrides, reversals); checked wallet opening RPC; expected target balance on opening assignment moves; deferred insert-only affordability guard for maintenance writes.
- [x] Opening forms: desired final balance, computed positive difference, previews, account inclusion confirmation, honest blocked guidance, duplicate/no-op/stale/retry tests; typed API expected-balance serialization.
- [x] Expense UI: default automatic group-first cover preview; show only the residual drawn from unassigned; explicit overrides still work; EN/AR.
- [x] Run full DB/UI suites, typecheck/build, independent review, bounded browser checks.
- [ ] Fresh private production backup and restore rehearsal; apply migration only (no financial correction), verify $900 and unchanged ledger; merge/publish frontend; live assets and authenticated reads.

**Review focus:** historical group membership, same-currency partial group coverage and future balance safety; source equal to charged item; explicit choice override; stale/replayed openings; negative unassigned never deepened by an opening assignment; all existing production money rows unchanged by release.
