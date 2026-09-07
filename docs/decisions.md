# Decisions ledger

Append-only project decisions and assumptions. Each entry records what would
change if the decision changes.

## 2026-09-07 — Isolated remote development database

**Decision:** Budget will use its own Supabase development stack on the Le
Labo Ubuntu host, reachable only through Tailscale. The React app remains on
the Mac. Hosted Supabase provisioning is deferred until launch approval.

**Why:** Isolation prevents Budget development from reading, changing, or
depending on the existing Sandooq development backend.

**If changed:** A shared or hosted backend would require a new data-isolation,
backup, endpoint, and operational review before any migration is applied.

## 2026-09-07 — Financial journal foundation

**Decision:** Store money as immutable typed events with signed wallet
movements; derive wallet balances rather than editing totals.

**Why:** It preserves a traceable history and makes reversals, idempotency, and
rejection tests enforceable at the database boundary.

**If changed:** A mutable-balance model would need a new audit and correction
design; a full accounting chart would expand the API, schema, and user-facing
concepts.

## 2026-09-07 — Foundation toolchain versions

**Decision:** Pin Node 22.22.0 and pnpm 11.17.0. The database test harness uses
TypeScript 7.0.2, Vitest 5.0.0, node-postgres 8.23.0, @types/node 26.4.1, and
@types/pg 8.23.1. Their recorded licenses are Apache-2.0 or MIT.

**Why:** The database foundation needs reproducible real-Postgres tests without
introducing a browser or application framework before the data boundary exists.

**If changed:** Upgrading a pinned dependency requires its own compatibility and
license review; replacing the test driver changes the integration-test boundary.
