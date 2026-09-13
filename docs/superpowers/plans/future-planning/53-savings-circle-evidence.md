# 53 — Savings circle money model evidence

**Layer:** evidence/specification only. **Roadmap:** E6.
**Depends on:** current core plans; no application implementation permission.
Read [00-start-here.md](00-start-here.md). Execute this bounded discovery task,
not a guessed database integration.

## Deliverables and missing-input handling

Deliver `docs/product/evidence/savings-circles.md` with one complete sanitized
example and20 numerical events. Required inputs: participants,organizer,each
contribution,currency,round dates,payout order,fees,missed payments,early exit,
who physically holds pooled cash and who can see whose obligations. Obtain rules
from the user or a supplied agreement; do not infer legal ownership from labels.

## Ordered work and acceptance

1. Inventory supplied inputs, consent and source dates; distinguish real from
   synthetic evidence. Do independent schema/fixture work while inputs are pending.
2. Follow the fixed investigation contract below.
3. Write a result matrix: proven, failed, blocked with exact missing input. List
   executable next-layer files only when their financial/provider contract closes.
4. Validate fixture syntax, links and numerical examples; commit documentation
   and sanitized fixtures only. No external upload/send/production SQL.

Draw ownership/custody/obligation separately. For each sample event specify
wallet deltas,receivable/payable deltas,ordinary income/expense and reversal. Sum
participant obligations and custodian cash before/after each round; explain late
payment, skipped payout, member removal and correction. Decide whether a circle
is metadata over loans or needs a separate obligation registry based on those
facts. Draft exact IDs/FKs/roles and command list, then rejection tests; unresolved
contractual rule stays flagged. No real participant invitation, payment or generic
loan opening until model is reviewed. SQL implementation is deliberately blocked
on cash ownership facts, not on cosmetic UI preferences.

A smaller model may finish this evidence deliverable with named blocked rows;
it must not label the dependent feature implementation-ready or implemented.
The task has no fake success quota when real inputs are absent.
