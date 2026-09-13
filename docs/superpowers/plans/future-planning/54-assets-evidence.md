# 54 — Assets and net-worth evidence

**Layer:** evidence/specification only. **Roadmap:** E7.
**Depends on:** current core plans; no application implementation permission.
Read [00-start-here.md](00-start-here.md). Execute this bounded discovery task,
not a guessed database integration.

## Deliverables and missing-input handling

Deliver `docs/product/evidence/assets-net-worth.md` with supported asset classes,
unit/quantity matrix and20 fixtures. Ask only whether v1 includes gold/property/
vehicles/securities and which valuation sources the user accepts; independently
specify a manual-valuation baseline requiring no provider.

## Ordered work and acceptance

1. Inventory supplied inputs, consent and source dates; distinguish real from
   synthetic evidence. Do independent schema/fixture work while inputs are pending.
2. Follow the fixed investigation contract below.
3. Write a result matrix: proven, failed, blocked with exact missing input. List
   executable next-layer files only when their financial/provider contract closes.
4. Validate fixture syntax, links and numerical examples; commit documentation
   and sanitized fixtures only. No external upload/send/production SQL.

Manual baseline: asset identity(space,kind,quantity exactnumeric,unit,currency),
append-only quantity events, dated value quotes(source,valuation method,amount),
no spendable balance or financial posting from revaluation. Net worth separates
cash,receivables,liabilities and noncash estimates per currency; consolidated number
requires explicit dated FX scenario and missing-value state. Avoid double-counting
assetpurchase cash expense and asset value as an expense twice. Prove sale/acquisition
mapping and archived asset history. Gold grams/troyounces need verified unit rules;
no inferred purity. Zakat is a separate domain-specific product with qualified
review, dates/liability rules and source evidence; no universal percentage added
as if all users/assets share one rule. Produce SQL schema/command test packet
only for asset classes with complete ownership/valuation semantics.

A smaller model may finish this evidence deliverable with named blocked rows;
it must not label the dependent feature implementation-ready or implemented.
The task has no fake success quota when real inputs are absent.
