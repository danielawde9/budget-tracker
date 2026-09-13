# Future-planning Markdown pack review — 2026-09-13

**Deliverable:** documentation-only implementation handoff, baseline `3a391ee`.
Entry: [execution index](../../superpowers/plans/future-planning/00-start-here.md).
No app code, applied migrations, account seeds, infrastructure, deployment or
external messages were created by this work. Existing unrelated workspace files
were excluded from the documentation commit.

## Checks performed

| Check | Observed result |
| --- | --- |
| Coverage | 59 Markdown files in the execution directory; all39 original roadmap IDs mapped exactly once in the coverage table |
| Local navigation | Relative links checked against actual files; no missing linked prerequisite |
| Markdown structure | Balanced code fences and consistent table column counts |
| SQL statement syntax | All13 SQL fenced blocks,55 statements, parsed by an isolated pglast validator |
| Procedural syntax | Seven non-trigger PL/pgSQL functions parsed; see trigger limitation below |
| TypeScript helpers | Four complete blocks extracted from07/08 and compiled with strict TypeScript |
| Allocation arithmetic | 5,005 amount/weight cases conserve every minor unit and retain results under input permutation |
| Additional helper checks |56/24/20 examples,maximum amount,invalid UUID/weights/money,safe-number boundary,valid/invalid calendar dates,chart clamping,and transport result/error handling passed |
| Whitespace/staged scope | `git diff --check` and staged documentation-only path inspection required immediately before commit |

The syntax validator is an ephemeral tool under `/tmp/budget-plan-sql-parser`;
it was not added to the project's dependencies or lockfile. Its PL/pgSQL JSON
adapter raised `JSONDecodeError` for the two trigger-returning helpers
`planning_reject_mutation` and `planning_guard_insert`. Their outer CREATE FUNCTION
syntax parsed. Their trigger bodies are **not** claimed parser-verified. No SQL
objects or function bodies were applied to a PostgreSQL database in this session.
Syntax parsing does not resolve catalog types/FKs, prove permissions, execute
constraints, or test races. Those are mandatory future DB-task acceptance checks.

## Reference-helper reproduction

Extract complete TypeScript fenced blocks beginning `export interface RpcResult`,
`export function object`, `export interface AllocationWeight` from task07 and
`export function chartPercent` from08 into an isolated temporary directory.
Compile with the repository compiler:

```bash
pnpm exec tsc --ignoreConfig --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --outDir /tmp/budget-plan-ts-check/out /tmp/budget-plan-ts-check/rpc.ts /tmp/budget-plan-ts-check/parse.ts /tmp/budget-plan-ts-check/allocation.ts /tmp/budget-plan-ts-check/chart.ts
node /tmp/budget-plan-ts-check/check.cjs
```

The local validation script used five weight vectors `[5600,2400,2000]`,
`[5000,3000,2000]`, `[3333,3333,3334]`, `[5600]`, `[0,0,0]`, each for every amount
0…1000 inclusive. For each, sum(output)=input and reversing the input group array
preserved the output by its fixed display order. The scripts are local review
aids; the implementation task must put equivalent tests beside its real helpers.

Child-request golden vector from the documented SHA256/UUID-bit algorithm:

```text
parent:    00000000-0000-0000-0000-000000000001
operation: income:USD:2026-09-01
json text: ["00000000-0000-0000-0000-000000000001", "income:USD:2026-09-01"]
expected:  e63ea2aa-fc33-8619-a338-f3bf5a4e0e80
```

This vector was calculated independently in Python. Task03 must prove the SQL
helper returns it in real PostgreSQL before downstream wrappers use it.

## Contract review changes incorporated

- Exact root/template/goal composite references, predecessor ordering and declared
  child counts prevent mixed-tenant sources, forks and late snapshot children.
- Space-lock order is shared with existing monthly setters and member lifecycle;
  actor-owned receipt replay precedes stale-head checks.
- Schedules deduplicate by stable schedule/date; materialization receipt returns
  counts rather than a500-UUID payload exceeding the16KiB receipt cap.
- Categorized ordinary posting uses the existing six-argument categorized RPC;
  category is not a fictional field in generic movement JSON.
- Goal fulfillment, expense inverses, partial refunds and recurring settlement
  use explicit links and do not create duplicate cash or contribution entries.
- Available-cash commitment overlap includes goal-covered budgeted bills; its
  daily guide means extra unassigned cash after existing budgets are reserved.
- SQL/gateway fields for available cash, carry previews, synthetic group IDs and
  ratio text were aligned. Shared parser rejects year0000 and noncanonical−0.
- CSV fixed format has nine columns. Other file/provider/domain formats have
  evidence tasks rather than silently inferred implementation rules.

## Evidence still required when implementation is requested

Real PostgreSQL red/green and direct-write rejection tests, two-client races,
empty journal replay and seeded upgrade, runtime DTO/gateway tests, actual UI
flows/RTL/accessibility and any explicitly requested live UAT/deployment.
No feature is marked implemented by this review.
