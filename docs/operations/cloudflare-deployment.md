# Cloudflare deployment runbook

This runbook is the release boundary for the Budget Tracker static single-page
application. It documents local preparation and operator checks; it does not
authorize a deployment, custom-domain change, or production-data access.

## Preconditions

Use Node 22.22.0 and pnpm 11.17.0. Start from the reviewed `main` branch and
install the locked dependency graph:

```bash
pnpm install --frozen-lockfile
```

The Cloudflare production branch is `main`. Release operators must use the
repository scripts and the pinned local tooling, never an ad-hoc global CLI.

## Build variables and local build

Enter these two build variables only through protected CI or Cloudflare
dashboard build settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Do not put their values in the repository, a command history, tickets, logs,
or documentation. The Supabase anon/publishable key is intentionally
browser-visible after Vite bundles it. It identifies the public client and
must be protected by Supabase Auth, RLS, and the approved PostgreSQL command
surface; it is not a privileged credential. A Supabase service-role key is
forbidden in the browser, Vite variables, Cloudflare static assets, and this
deployment path.

With the protected variables present, produce the deployable static bundle:

```bash
pnpm build:cloudflare
```

This validates the approved variable names before running the production Vite
build. A successful build proves only that the repository can produce `dist/`;
it does not prove a deployed route, Auth session, RLS decision, persistence,
backup, or recovery operation.

## Deployment sequence

First inspect the generated release without changing Cloudflare:

```bash
pnpm deploy:cloudflare:dry-run
```

After a responsible owner has approved the release and the dry-run output,
perform the first workers.dev deployment with:

```bash
pnpm deploy:cloudflare
```

The initial public-beta address is the generated workers.dev endpoint. Adding
or changing a custom domain, DNS record, route, zone setting, or access policy
is owner-gated work outside this command and requires a separate approval.

## Post-deploy smoke checks

Use a synthetic or replaceable data account only. At the deployed workers.dev
address, verify all of the following and retain only non-sensitive evidence:

1. `/` loads the application shell over HTTPS, and a deep application URL
   refreshes back to the SPA shell.
2. A synthetic user can sign in and sign out without exposing tokens in logs
   or screenshots.
3. RLS boundaries hold: the user sees only its own permitted space, wallet,
   categories, and ledger records; an unauthorized direct object or command
   attempt is rejected.
4. A permitted financial mutation uses the approved command path and the
   resulting derived balance and immutable history are visible after reload.

Do not use a customer account or live customer financial data for public-beta
release verification.

## Rollback and recovery evidence

If a smoke check fails, stop further rollout and roll back to the previously
verified Cloudflare version through the Cloudflare deployment/version controls.
Record the release version, time, operator, failure symptom, rollback result,
and the follow-up owner. Do not treat a local dry-run, a successful upload, or
an offline browser suite as rollback proof.

The public beta remains intentionally limited: it has no proof yet of a custom
domain, customer-data operation, production Auth/RLS behavior, database
persistence, backup restoration, or a completed rollback drill. Before
expanding access, collect the corresponding controlled recovery and live
session evidence, then obtain the required owner approval.
