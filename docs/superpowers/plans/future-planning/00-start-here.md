# Future planning — execution index

**Planning baseline:** `3a391ee`, 2026-09-13. **Scope of this session:** write
implementation Markdown, not application code, applied migrations or production
changes. The owner requested conversion of the entire future roadmap into
actionable work. A future execution request selects a file/step below.

This directory supersedes the coarse execution instructions in
[the earlier packet plan](../2026-09-13-future-planning-implementation.md).
Product intent remains in the two September 13 specifications. Where an exact
contract here refines an ambiguity there, this directory's execution contract
wins. The refinements are listed in [the SQL rules](01-sql-contract.md).

## How a smaller model should work

1. Read this index, the selected task file, and its linked prerequisite files.
2. Verify the starting commit, existing RPC signatures and prerequisite evidence.
   “Document exists” is not “feature implemented.” Skip code already proved in
   current source; run its regression tests rather than recreate it.
3. Execute one named layer at a time. Each file defines allowed paths, SQL or
   application contracts, fixtures, ordered steps, commands and a commit boundary.
4. Run the failing test first. For SQL, test on an isolated real PostgreSQL
   database through the existing disposable harness. A SQL parser or mock is
   not the acceptance engine.
5. Implement only the listed contract, run its checks, inspect staged files,
   commit and write an evidence record. Stop at the file's exit; do not silently
   start its dependent file.

Use `superpowers:executing-plans`, `superpowers:test-driven-development`, and
`superpowers:systematic-debugging` when needed. Do not rename files or loosen a
test to evade an existing release/scope gate. The new feature's explicit request
defines its scope; preserve the historical private-UAT rehearsal baseline.
Source changes to a shared UI outside the selected file need separate scope.

No push, deployment, production SQL, category seeding, external message, paid
service adoption, or unattended posting follows from these documents. Normal
implementation does not need repeated permission for each reversible edit.

## Execution order

| Order | Work file | Layer | Depends on |
| --- | --- | --- | --- |
| 1 | [02: verify reporting](02-reporting-verification.md) | DB | Current source |
| 2 | [03: common planning boundary](03-planning-foundation-db.md) | DB | 02 |
| 3 | [04: allocation tables](04-allocation-schema-db.md) | DB | 03 |
| 4 | [05: allocation commands](05-allocation-commands-db.md) | DB | 04 |
| 5 | [06: allocation projections](06-allocation-projections-db.md) | DB | 05 |
| 6 | [07: allocation gateway](07-allocation-gateway.md) | Gateway | 06 |
| 7 | [08: allocation setup and charts](08-allocation-ui.md) | UI | 07 |
| 8 | [09: goal tables](09-goals-schema-db.md) | DB | 03, 04 |
| 9 | [10: goal commands](10-goals-commands-db.md) | DB | 09 |
| 10 | [11: goal projections](11-goals-projections-db.md) | DB | 10, 06 |
| 11 | [12: goals gateway](12-goals-gateway.md) | Gateway | 11 |
| 12 | [13: goals and milestones UI](13-goals-ui.md) | UI | 12, 08 |
| 13 | [14: recurring drafts](14-recurring-db.md) | DB | 03, 10 |
| 14 | [15: recurring gateway](15-recurring-gateway.md) | Gateway | 14 |
| 15 | [16: upcoming bills UI](16-recurring-ui.md) | UI | 15 |
| 16 | [17: available cash and outlook](17-available-cash-db.md) | DB | 11, 14 |
| 17 | [18: cash-control gateway](18-available-cash-gateway.md) | Gateway | 17 |
| 18 | [19: cash-control UI](19-available-cash-ui.md) | UI | 18, 16 |
| 19 | [20: copy and signed rollover](20-month-copy-rollover-db.md) | DB | 06, 11, 14 |
| 20 | [21: month transitions gateway](21-month-transitions-gateway.md) | Gateway | 20 |
| 21 | [22: month transitions UI](22-month-transitions-ui.md) | UI | 21 |

Independent daily-entry, money-event and household work is routed through
[40: the complete roadmap coverage map](40-roadmap-coverage.md). Each item has
one concrete work file. Research-dependent items have an executable evidence
task with exact output criteria, not permission to invent an integration.

## What is exact, and what still requires proof?

Exact here: schema shapes, public signatures/payloads, state transitions,
formulas, bounds, lock/replay order, invalid cases, expected test values and
file ownership. SQL fenced blocks are implementation material to put into a
new migration only during the requested DB task. They have not been applied
or integration-tested by this planning session. The implementer must write
the full migration, including the accompanying constraints/triggers/ACLs and
command algorithm steps in the same file; copying only CREATE TABLE blocks
does not satisfy a task.

Allocation/goals defaults use expected net income, per-currency month snapshots,
root-only category budgets and advisory goal earmarks. No hidden cash hold.
All default policy details are resolved in task files. Provider-dependent work
is explicitly an evidence task until its missing inputs exist.

## Required evidence record

At completion, create `docs/verification/future-planning/<task-id>.md` containing:

```text
Task ID and layer:
Starting SHA / final SHA:
Files and migration suffixes owned:
Prerequisite evidence inspected:
Decisions and deviations:
Red test command / expected failure / observed failure:
Green focused command / result:
Full required checks / actual totals:
SQL role and tenant rejection matrix:
Two-connection race result:
Empty replay / seeded upgrade / unchanged prior digests:
UI synthetic checks / authenticated UAT (separate statuses):
Deployment status (separate):
Remaining limitation or next task:
```

These labels are an evidence form, not fabricated results. Fill them from the
current execution. Never mark a skipped or unreachable check Pass.

## Smaller-model prompt

> Execute task 02 from `docs/superpowers/plans/future-planning/02-reporting-verification.md`.
> Read `00-start-here.md`, `01-sql-contract.md`, and `01-test-recipes.md` first.
> Own only this file's declared layer. Re-check current source and prerequisite
> evidence. Follow its contracts, write failing tests, implement only required
> changes, run its exact checks, and commit green steps with the decisions and
> evidence entries. Preserve existing journal, auth and loan behavior. Do not
> continue to another task or push/deploy/apply production SQL. If an input is
> missing, complete the file's permitted independent work and report the exact
> missing prerequisite; do not invent financial behavior.

## Planning-session validation

See [the plan-pack review](../../../verification/future-planning/plan-pack-review.md)
for syntax/helper checks actually run while authoring these files. Those results
do not replace any task's future real-PostgreSQL, gateway or UI acceptance gate.
