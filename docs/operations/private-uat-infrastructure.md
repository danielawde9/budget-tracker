# Private exact-schema UAT infrastructure

## Current status

The infrastructure definition is locally verified and committed on the
unpushed branch `codex/budget-uat-18-infrastructure`. Remote provisioning is
currently **Blocked** by the Ubuntu host's Tailscale SSH reauthorization gate.
No UAT directory, container, network, volume, secret file, migration, or
Tailscale Serve route has been created.

This runbook is for the exact release lineage rooted at
`6af62c1b0105b75a9796cfb299791f4c26a7dd2e`. It must not use the ignored
`.env.local`: that file identifies a hosted Supabase project, not this isolated
Ubuntu UAT environment. Cloudflare frontend deployment is outside this
infrastructure layer.

## Fixed boundary

| Item | Exact value |
|---|---|
| SSH host | `lelabo@100.76.160.91` |
| Ubuntu root | `/home/lelabo/budget-uat-18` |
| Compose project | `budget-uat-18` |
| Containers | `budget-uat-18-db`, `budget-uat-18-auth`, `budget-uat-18-rest`, `budget-uat-18-kong` |
| Network | `budget-uat-18-net` |
| Volume | `budget-uat-18-db-data` |
| Gateway binding | `127.0.0.1:54521` |
| PostgreSQL binding | `127.0.0.1:54522` |
| Restart policy | `no` on all four containers |
| Migration set | exactly 18 ordered files through `20260908103000` |

The gateway and database are loopback-only. A tailnet-only HTTPS route may be
added later only if the installed Tailscale Serve configuration can preserve
every existing TCP route and keep Funnel disabled. Do not substitute public
HTTP, a LAN bind, Funnel, certificate bypass, or a public provider project.

## Operator sequence

Run every command from the release worktree. The entrypoint validates the
release lineage and the SHA-256 of every migration before contacting Ubuntu.

```bash
pnpm install --offline --frozen-lockfile
pnpm check:uat:infra
./scripts/ops/budget-uat-18.sh preflight
./scripts/ops/budget-uat-18.sh sync
./scripts/ops/budget-uat-18.sh provision
./scripts/ops/budget-uat-18.sh verify
```

`preflight` is read-only. `sync` creates only the marked private UAT root and
copies the Compose/Kong inputs, manifest, and 18 migration files. `provision`
creates the four named services and their named network/volume, generates a
mode-`0600` ignored secret environment on Ubuntu, and applies the empty
database journal once. `verify` creates only disposable `.test` Auth users and
synthetic UAT records inside this disposable database.

The verification receipt is intentionally limited to identities and pass/fail
tuples. It must never contain passwords, JWTs, publishable keys, session tokens,
synthetic email addresses, credential-bearing URLs, or raw data records.

## Stop and destructive cleanup

Stop preserves the UAT database volume:

```bash
./scripts/ops/budget-uat-18.sh stop
```

The environment is deliberately one-shot. After `stop`, remove it and provision
a fresh exact-schema environment rather than trying to reuse or rotate its
secret file in place.

Cleanup is destructive only for the exact marked and Compose-labelled UAT
resources. It removes the four containers, UAT network, UAT database volume,
and exact UAT root. Synthetic Auth and financial records are not recoverable
afterward.

```bash
./scripts/ops/budget-uat-18.sh cleanup
```

If provisioning stops after the private `.env` is created, do not print or copy
that file. Inspect only non-secret container health/log summaries, then use the
same exact cleanup command before retrying `sync` and `provision`. If marker,
label, path, port, hostname, Tailscale address, migration hash, development
database identity, or file-mode checks fail, stop and investigate; never weaken
the guard to continue.

## Required acceptance evidence

Formal private UAT infrastructure readiness requires all of the following in
one fresh run:

- four healthy UAT containers, restart policy `no`, and only the two loopback
  bindings above;
- PostgreSQL `170006` with a system identifier different from Budget
  development;
- exactly 18 ordered journal rows and 18/18 matching SQL hashes;
- RLS enabled on all 11 scoped relations, no direct writes for the three API
  roles, and the reviewed reversal function ACL;
- real signup, refresh, global sign-out, revoked-refresh rejection, PostgREST,
  one protected command, anonymous rejection, and two-user tenant rejection;
- mode `0700` for the UAT root/migration directory and `0600` for secrets and
  synchronized inputs;
- byte-for-byte-equivalent Budget development identity, container/restart
  snapshot, and 31-row migration journal before and after;
- private HTTPS with ordinary certificate verification, or an explicit HTTPS
  blocker that prevents a readiness claim.

This is infrastructure and minimal Auth/API smoke only. It is not full product
UAT, physical-device proof, production deployment, backup/restore proof, SMTP
readiness, or authorization to enter real financial data.
