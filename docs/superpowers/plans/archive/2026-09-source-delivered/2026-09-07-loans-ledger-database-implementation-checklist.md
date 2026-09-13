# Loans and ledger database implementation checklist

## Delivery boundary

Implement only the protected PostgreSQL schema, commands, projections, tests,
coverage inventory, and operating evidence for Loans. UI, sign-in flows,
deployment, reminders, interest, fees, installments, forgiveness, and
cross-currency settlement are explicitly excluded.

## Ordered checklist

- [ ] Establish a baseline from the existing migrations and real-Postgres test
  harness: inspect the current command surface, run typecheck and tests, and
  record only verified foundation behavior.
- [ ] Read the Ubuntu stack status without changing it. Before any database
  test or migration operation, confirm the remote Budget project path, port,
  and database identity; never start, reset, or address Sandooq.
- [ ] Add red real-Postgres tests for loan creation in both directions, opening
  outstanding obligations without wallet cash, lending, borrowing, partial and
  full repayments, currency and membership rejection, and reconstruction from
  posted history.
- [ ] Add a new forward-only migration for loan domain types, loan records,
  immutable loan postings linked one-to-one with financial events, derived
  balance views, indexes, RLS, direct-write revocation, and history guards.
- [ ] Add protected, idempotent commands for opening obligations, lending,
  borrowing, receiving a repayment, and repaying a borrowing. Validate exact
  bounded positive integer minor units, active membership, same-space wallet,
  same currency, and event shape before inserts; serialize each loan before
  accepting a repayment.
- [ ] Add red tests and then protected correction behavior: reverse linked loan
  and wallet effects atomically, preserve source rows, and reject a reversal
  when later dependent repayments would become invalid.
- [ ] Add monthly-target tables and read-only projections. Test targets make no
  journal or balance changes, actual repayments count once, remaining planned
  repayment is never negative, due amounts stay distinct, and expected
  collections are not spendable.
- [ ] Inventory every currently implemented financial command and repository
  entry path. Add a coverage test/gate that rejects unclassified write-capable
  financial functions, direct client table writes, and bypasses; document the
  boundary for future features without implying they exist.
- [ ] Test replay collisions, concurrent repayments, rollback, table-write
  privilege/RLS defenses, UPDATE/DELETE/TRUNCATE guards, empty-schema migration,
  and a seeded upgrade migration on the approved isolated target.
- [ ] Append material implementation decisions to the ledger, run the complete
  typecheck and database evidence set, and commit each independently verified
  step using conventional commit messages. Do not push, deploy, or touch
  unrelated `.swarm/` changes.
