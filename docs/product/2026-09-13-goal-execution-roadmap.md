# `/goal` execution roadmap

Prepared 2026-09-13 from the current future-planning task pack. This is a
planning estimate, not permission to begin all work at once. One `/goal` chat
owns one named layer or substep, ends at a green commit plus its evidence record,
and does not silently continue into its dependent layer.

Each implementation chat includes its packet's focused red/green test loop.
The listed release gates are separate chats because they run the whole relevant
matrix, inspect scope, and record desktop/mobile/English/Arabic/RTL evidence.
They do not include a hosted deployment or live-account action unless that is
separately requested.

| Sequence | Packets | Implementation chats | Release-gate chats | Total |
| --- | --- | ---: | ---: | ---: |
| Income allocation and daily comparison release | 02–08 | 7 | 1 | 8 |
| Goals and milestones release | 09–13 | 5 | 1 | 6 |
| Recurring bills and cash-control release | 14–19 | 6 | 1 | 7 |
| Month copy, close and signed rollover | 20–22 | 3 | 1 | 4 |
| Journal search, export and daily tools | 23–26 | 4 | 1 | 5 |
| Financial-event extensions | 27–34, then 35–36 per completed SQL slice | 25 | 2 | 27 |
| Household profiles, check-ins, insights and recap | 37–42, 49 | 6 | 1 | 7 |
| CSV import, quick text and pay-date planning | 43–48 | 6 | 1 | 7 |
| Evidence-gated research only | 50–56 | 7 | 0 | 7 |
| Existing-feature verification | 57 | 1 | 0 | 1 |
| MCP1 private-account connector | M0–M5 | 5 | 1 | 6 |
| **Full documented roadmap** | 02–57 plus MCP1 | **75** | **10** | **85** |

The financial-extension total is deliberately decomposed: task 32 has three
committed DB substeps (32a–c); task 34 has three (34a–c); and each completed
financial DB capability receives its own gateway and UI slice under 35 and 36.
That is the safe way to preserve exact money semantics and independently prove
each command boundary.

## Required evidence in every implementation chat

- Database packets: real PostgreSQL failing/rejection tests first; migration
  replay on empty and seeded databases; role/tenant denial, direct-write and
  two-connection race tests; focused green run; then the packet's required full
  database suite.
- Gateway packets: strict DTO and transport/reconciliation tests, bounded reads,
  exact minor-unit strings, and no new browser write path outside approved RPCs.
- UI packets: component/flow coverage plus actual desktop and mobile interaction
  checks in English and Arabic/RTL, keyboard and screen-reader-relevant labels.
- Release-gate chats: `pnpm check`, relevant worker and E2E suites, visual
  regression/UAT evidence, `git diff --check`, staged-scope review, decisions
  ledger and task evidence record. A failure invokes systematic debugging and
  may add a corrective `/goal` chat; it is not counted as a pass.

Start with [task 02](../superpowers/plans/future-planning/02-reporting-verification.md),
then follow the dependency order in the
[future-planning execution index](../superpowers/plans/future-planning/00-start-here.md).
The first user-visible release is therefore **8 `/goal` chats**, not a single
large change. The full estimate is a baseline: owner decisions, a confirmed
defect, or an external-provider gate can add chats, while a current-source
verification may remove an already-satisfied packet.
