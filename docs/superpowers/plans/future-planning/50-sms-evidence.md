# 50 — SMS draft parser evidence

**Layer:** evidence/specification only. **Roadmap:** E1.
**Depends on:** current core plans; no application implementation permission.
Read [00-start-here.md](00-start-here.md). Execute this bounded discovery task,
not a guessed database integration.

## Deliverables and missing-input handling

Deliver `docs/product/evidence/sms-drafts.md` and sanitized fixtures under
`tests/fixtures/sms/`. Need at least20 consented, redacted messages across selected
senders, including Arabic/Latin digits, reversals, balance notifications, foreign
currency and ambiguous dates. Do not fetch private messages or retain account
numbers just to fill the fixture quota. With no supplied examples, create the
fixture schema and synthetic adversarial tests and label real-sample coverage0.
Ask for only supported senders/consented sanitized examples when needed.

## Ordered work and acceptance

1. Inventory supplied inputs, consent and source dates; distinguish real from
   synthetic evidence. Do independent schema/fixture work while inputs are pending.
2. Follow the fixed investigation contract below.
3. Write a result matrix: proven, failed, blocked with exact missing input. List
   executable next-layer files only when their financial/provider contract closes.
4. Validate fixture syntax, links and numerical examples; commit documentation
   and sanitized fixtures only. No external upload/send/production SQL.

Fixture JSON: id,senderClass,text,expected{kind,amountMinor,currency,effectiveDate,
payee}|null,ambiguities[]. Redact names/account/card identifiers consistently.
Measure exact amount/currency/date precision; acceptance is zero confidently wrong
money fields in this set, ambiguous messages return unresolved. A balance-only
notification must never become an income draft. Produce supported grammar table,
normalization steps and parser interface reusing44b DraftParseResult. No SMS
permission/background inbox ingestion/provider; paste-only. SQL impact should be
none until draft persistence is separately required. Downstream UI uses45 review;
no posting without explicit confirmation.

A smaller model may finish this evidence deliverable with named blocked rows;
it must not label the dependent feature implementation-ready or implemented.
The task has no fake success quota when real inputs are absent.
