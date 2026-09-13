# Future-plan carry-over — proposed design

**Status:** owner-approved planning structure, pending review of this written
specification. This document authorizes no application code, migration,
database application, deployment, push, or production action.

## Purpose

Make four known carry-over concerns visible, testable future packets without
quietly changing the private-UAT-frozen implementation. Each packet has one
owner, one layer boundary, and an independent exit condition.

| Packet | Purpose | Layer | Dependency |
| --- | --- | --- | --- |
| V0a | Reproduce and, only if real, repair the reporting `currency` ambiguity | Database | Existing V0 reporting verification |
| X4a | Add direct wallet, root-category, and currency filtering to journal search | Database → gateway → UI | Existing tasks 23, 25, 26a |
| U1 | Make sheets consistently contain and restore keyboard focus | Shared UI accessibility | Existing dialog/sheet primitives |
| U2 | Consolidate the two client translation paths behind one typed boundary | Shared UI infrastructure | U1 is independent; do not combine implementations |
| T1 | Diagnose and make the pre-existing planner-statistics DB test deterministic | Test infrastructure | Existing `test:db` suite |

## V0a — reporting RPC ambiguity

The first database packet adds an isolated real-PostgreSQL reproducer for each
existing reporting RPC that exposes an output column named `currency`. It must
call the RPC as an authenticated member, assert a successful bounded result,
and distinguish the PostgreSQL `42702` ambiguity error from a wrong result,
authorization failure, or unavailable fixture.

If and only if the failure is reproduced, make one timestamped forward
migration that qualifies the conflicting identifier in the specific function.
Preserve the public RPC signature, result field order, RLS behavior, and
currency-specific amounts. Replay the migration journal on an empty database
and a seeded-prefix database; no existing migration is edited. If no failure is
reproduced, record that result and make no migration.

## X4a — direct journal filters

The journal-search contract gains a nullable `p_currency` argument alongside
the existing wallet and root-category arguments. `NULL` means every currency;
an explicit value matches a movement/allocation in that currency. A transfer or
split stays one event row when any qualifying nested movement matches. The
result does not combine currencies or treat a wallet's currency as a substitute
for a direct currency filter.

The typed gateway exposes the same optional field and validates only supported
currency codes. The journal toolbar offers wallet, root category, and currency
controls, clears pagination on any filter change, and labels the nested-event
semantics. Tests cover each filter alone, their intersection, cross-space IDs,
mixed-currency transfers, no-results, cursor stability, English/Arabic and
RTL. The existing page-size/date/query bounds remain unchanged.

## U1 — sheet focus containment

Create or extend exactly one shared sheet primitive. When open, it puts initial
focus on the designated interactive element, keeps Tab and Shift+Tab within the
sheet, closes safely on Escape when not pending, restores focus to the invoking
control, and has a labelled dialog/sheet semantic. Pending financial
confirmations retain the existing no-dismiss behavior. Native dialogs that
already satisfy the contract are not rewritten.

Component tests exercise forward and reverse tab wrapping, Escape, restoration,
pending state, and mobile full-screen behavior. Each migrated sheet receives a
small integration test proving it uses the primitive. This packet does not
redesign screens or alter posting/gateway logic.

## U2 — one translation boundary

Inventory current translation imports and classify every key as shared or
feature-owned. Introduce a single typed translation interface that accepts the
current locale and exact English/Arabic values or registered keys. Migrate one
feature at a time with unchanged copy and locale behavior, then remove the
superseded path only when repository-wide imports are gone.

The boundary must preserve `<bdi>` treatment for database values and logical
CSS/RTL behavior. It does not introduce a third-party i18n dependency, modify
product wording, or transliterate user data. Tests compare English and Arabic
rendering for each migrated feature and use a source-ratchet to prevent new
imports from the retired path.

## T1 — planner-statistics test reliability

Start by running the exact failing case from the current branch and from the
recorded old-main baseline, with the same env-loaded disposable PostgreSQL
setup. Capture the query, plan assertion, row counts, PostgreSQL version, and
statistics state. A failure caused by infrastructure availability is reported
separately from a planner assertion failure.

If the failure depends on stale or insufficient statistics, make fixture setup
deterministic using the smallest necessary `ANALYZE`/fixture-size change and
assert the relevant behavior rather than forcing a plan. If it is a genuine
regression, retain a red reproducer and route it to its source layer. Do not
skip, weaken, or quarantine the test. The final packet documents whether the
full DB gate is once again a reliable prerequisite for future database work.

## Completion boundaries

Each packet writes a separate evidence record under
`docs/verification/future-planning/`, includes Pass/Fail/Blocked results, and
commits independently. V0a and T1 run their focused test plus the env-loaded
DB completion gate. X4a progresses only DB → gateway → UI after its predecessor
is green. U1 and U2 run focused UI tests, typecheck, UI suite, build, and their
named Playwright coverage. None grants permission to deploy, push, mutate
production, or change the UAT-frozen scope.
