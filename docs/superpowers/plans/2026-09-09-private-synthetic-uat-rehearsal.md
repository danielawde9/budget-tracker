# Private synthetic UAT rehearsal plan

**Deliverable:** A reproducible, offline, fixture-backed acceptance rehearsal for
the release at `d4bf9d2c39063eb52782188a2f860d3099994361`, with an honest boundary
between simulated browser integration and live authenticated UAT.

## Scope

- Audit and document the existing Auth/E2E boundary.
- Exercise the authenticated shell, Wallets/general transactions, Loans,
  Categories, archived-category history, reload behavior, and backup-readiness
  messaging using synthetic identities and synthetic minor-unit amounts only.
- Cover desktop and mobile plus English LTR and Arabic RTL, including normal,
  empty, rejected, ambiguous, retry, and recovery states that the offline
  harness can deterministically prove.
- Record a Pass/Fail/Blocked matrix and exact reproduction commands.

## Boundaries

- Do not contact Supabase, Ubuntu, SSH, providers, production, or public hosts.
- Do not change migrations, ledger logic, RPCs, permissions, or financial
  gateway implementations.
- Do not add Household, Monthly Budget, Reporting, invitation email, password
  recovery, deployment, or launch behavior.
- Treat fixture state retained across a browser reload as harness persistence,
  not PostgreSQL persistence. Treat injected local-storage sessions as mocked
  Auth, not real Supabase authentication.

## Execution

1. Run a frozen offline install and baseline ops/UI/typecheck/build/E2E checks.
2. RED: add focused component/E2E assertions for backup-readiness messaging,
   protected mutation coverage, archived history, and reload retention.
3. GREEN: add the smallest read-only readiness UI and deterministic fixture
   state/receipts needed by those assertions.
4. Run the full offline verification matrix plus secret, direct-write, migration,
   and scope-diff ratchets.
5. Commit non-sensitive evidence and reproduction instructions, request an
   independent review, address all critical/important findings, and rerun the
   complete matrix.
