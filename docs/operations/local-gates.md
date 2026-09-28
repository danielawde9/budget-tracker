# Running the service-backed gates on a workstation

This is a reproducible driver for the two repository gates that need something
outside the checkout: `pnpm test:db` (a real Postgres) and `pnpm check:ops`
(a Docker endpoint for its one container-backed test). Everything else in
`pnpm check` — `typecheck`, `test:worker`, `test:ui`, `build` — needs only the
locked dependency graph and runs offline.

Nothing here authorizes a deployment, a hosted-secret change, or live-data
access. These gates use disposable/synthetic targets only.

## Prerequisites

| Requirement | Version / value | Why |
| --- | --- | --- |
| Node | 22.22.0 | `.nvmrc`/`package.json` toolchain |
| pnpm | 11.17.0 | `packageManager` field |
| Tailscale | up and authorized to the Budget tailnet | reaches the dev Postgres host |
| Dev Postgres host | `lelabo@100.76.160.91` (Tailscale), Postgres ports `54421–54424` | `pnpm test:db` target |
| `.env.test` | gitignored, per-checkout | holds `BUDGET_TEST_DATABASE_URL` |
| Docker endpoint | a local Docker daemon **or** the tracked SSH bridge | `pnpm check:ops`' restore test |

Install the locked graph first:

```bash
pnpm install --frozen-lockfile
```

### The dev database

`docs/operations/ubuntu-development-stack.md` owns the stack. Bring it up and
confirm it before a DB run:

```bash
./scripts/remote-supabase.sh start
./scripts/remote-supabase.sh status
```

The database suite reads its server **only** from `BUDGET_TEST_DATABASE_URL`
(`tests/db/test-database.ts`, `tests/db/disposable-database.ts`). Create the
gitignored `.env.test` from the tracked template and fill the value from the
operator secret store; never commit it:

```bash
cp .env.test.example .env.test   # then set BUDGET_TEST_DATABASE_URL
```

The recorded test URL points at the dedicated Budget dev stack on
`100.76.160.91` (port `54422`). The firewall service there permits the Budget
port range from Tailscale addresses only, so the host must be reachable **over
Tailscale** — host LAN addresses are expected to refuse the connection.

### The Docker endpoint

`tests/ops/supabase-scratch-restore.test.ts` provisions the exact
`supabase/postgres` image through Testcontainers, which needs a Docker endpoint
it can reach as a **unix socket** (Testcontainers 12.1.0 does not speak
`ssh://`). Two supported ways to provide one:

- A local Docker daemon (e.g. Docker Desktop) with its socket at the default
  path; or
- The tracked bridge to the Le Labo Ubuntu daemon, which presents a private
  local unix socket to the command it wraps (see the *Tests* subsection of
  `docs/operations/backup-restore-runbook.md`).

`scripts/ops/check-local-gates-prereqs.sh` reports which of these are reachable
without running either suite.

## Gates, commands, and expected results

### 1. `pnpm test:db` — database integration suite

```bash
set -a
source ./.env.test
set +a
pnpm test:db
```

`test:db` is `vitest run tests/db --pool=forks --no-file-parallelism`. Expected:
the suite connects, creates disposable databases, and reports its file/test
tallies. Compare against the committed baseline in
`docs/verification/2026-09-25-phase-0-baseline.md` §2 — only *new* failures
count against a change.

How an **environment** failure presents (not a test result):

- `BUDGET_TEST_DATABASE_URL` unset/empty:
  `Error: BUDGET_TEST_DATABASE_URL must be set for database integration tests`.
- Host unreachable (Tailscale down, wrong host/port, firewall): connection
  attempts hit the harness's `connectionTimeoutMillis: 10_000` and the suite is
  blocked before any assertion runs.

### 2. `pnpm check:ops` — ops suite + syntax/secret scan

`check:ops` is `bash scripts/ops/check-budget.sh`. It runs `bash -n` across the
tracked ops scripts (plus `shellcheck` when installed), a bounded tracked-text
secret scan, and — unless static-only — `vitest run tests/ops --pool=forks
--no-file-parallelism`.

**Static-only (no Docker needed):**

```bash
BUDGET_OPS_STATIC_ONLY=1 pnpm check:ops
```

This is exactly the syntax/lint/secret-scan portion; it skips `tests/ops`
entirely, so it is safe on a machine with no container runtime. Expected:
`Budget ops verification passed`.

**Full, with a working Docker endpoint:**

```bash
pnpm check:ops                                   # local Docker daemon
scripts/ops/docker-ssh-bridge.sh run -- pnpm check:ops   # Le Labo daemon via Tailscale
```

How an **environment** failure presents (not a test result): with no reachable
Docker daemon, `tests/ops/supabase-scratch-restore.test.ts` fails to start with
`Error: Could not find a working container runtime strategy` (Testcontainers).
That is a suite-level failure of the one container-backed file; the rest of
`check:ops` still runs.

### 3. Service-free gates (context)

`pnpm check:ui` (`typecheck` → `test:ui` → `build`), `pnpm test:worker`, and
`pnpm build` need none of the above. `pnpm check` chains all of them plus
`test:db`, `test:worker` and `check:ops`, so on a workstation without the
database and Docker it will stop at those two gates.

## What a green run proves

- `test:db` green proves the SQL and the disposable-Postgres harness agree on
  the **dev** database, for this checkout, at this time. It is not production,
  backup, or restore evidence.
- `check:ops` green (full) proves the ops scripts parse and pass their tests,
  including the scratch-restore pipeline against the pinned image. The
  static-only run proves only syntax/lint/the secret scan.
