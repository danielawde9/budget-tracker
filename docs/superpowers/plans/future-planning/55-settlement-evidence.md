# 55 — Household settle-up accounting evidence

**Layer:** evidence/specification only. **Roadmap:** E8.
**Depends on:** current core plans; no application implementation permission.
Read [00-start-here.md](00-start-here.md). Execute this bounded discovery task,
not a guessed database integration.

## Deliverables and missing-input handling

Deliver `docs/product/evidence/household-settlement.md` with ten complete household
examples. Required facts: wallet owner,payer,expense beneficiaries,who owes whom,
rounding rule,currency,shared fund contributions,refund distribution and disputes.
Same household access does not establish equal ownership or 50/50 sharing.

## Ordered work and acceptance

1. Inventory supplied inputs, consent and source dates; distinguish real from
   synthetic evidence. Do independent schema/fixture work while inputs are pending.
2. Follow the fixed investigation contract below.
3. Write a result matrix: proven, failed, blocked with exact missing input. List
   executable next-layer files only when their financial/provider contract closes.
4. Validate fixture syntax, links and numerical examples; commit documentation
   and sanitized fixtures only. No external upload/send/production SQL.

Candidate immutable attribution set: event,space,expected revision,linecount;
lines member,benefitAmountMinor,paidAmountMinor with exact sum checks. Derive per-
currency balances; repayment references existing loan/transfer event rather than
manufacturing an ordinary expense. Test2001 split two people→1001/1000 with explicit
stable recipient order, not floating rounding. Household joint wallet payment,
private wallet reimbursement,removed member,partial settlement,refund and inverse
must reconcile. No one can allocate obligations to a nonconsenting unrelated user.
Clarify visibility and correction authority, then produce dedicated DB/gateway/UI
plans. Until those inputs exist, presentation labels37 must not be used as the
accounting ownership ledger.

A smaller model may finish this evidence deliverable with named blocked rows;
it must not label the dependent feature implementation-ready or implemented.
The task has no fake success quota when real inputs are absent.
