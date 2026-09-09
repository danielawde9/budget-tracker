# Budget exact-schema UAT infrastructure receipt

Run date: 2026-09-09 EEST

Release source: `6af62c1b0105b75a9796cfb299791f4c26a7dd2e`

Implementation branch: `codex/budget-uat-18-infrastructure` (local and unpushed)

## Verdict

Remote UAT infrastructure: **Blocked / not provisioned**.

The local, fail-closed infrastructure definition and verification tooling are
green. The bounded read-only Ubuntu preflight reached the Tailscale SSH
reauthorization gate and exited `255`. No remote mutation followed that failure.
An operator must complete the host's Tailscale SSH authentication before this
receipt can be replaced with live provisioning evidence.

The ordinary checkout's ignored `.env.local` identifies a hosted Supabase
project. It was not read, copied, contacted, or used. No Cloudflare resource was
created or changed.

## Sanitized evidence retained

The earlier successful read-only inventory established these non-secret facts;
they must be re-measured after SSH access is restored:

```text
HOST|name=lelabo|tailscale_ipv4=100.76.160.91
CAPACITY|cpu=8|memory_available_kib=25421568|home_available_kib=878676016
DOCKER|version=29.7.2
UAT_COLLISIONS|root=absent|gateway_54521=free|database_54522=free
UAT_REMOTE_MUTATIONS|directories=0|containers=0|networks=0|volumes=0|serve_routes=0
BUDGET_DEV|containers=12|restart_count_nonzero=0|system_id=7683090997378195493
BUDGET_DEV_JOURNAL|count=31|last=20260908180000
TAILSCALE_SERVE|https_handlers=0|existing_tcp_routes=preserved
SSH_RETRY|result=reauthorization_required|exit=255
```

The observed host already cached these four immutable image digests used by the
Compose definition:

```text
postgres|public.ecr.aws/supabase/postgres:17.6.1.165@sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518
gotrue|public.ecr.aws/supabase/gotrue:v2.196.0@sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232
postgrest|public.ecr.aws/supabase/postgrest:v16.1@sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d
kong|public.ecr.aws/supabase/kong:2.8.1@sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d
```

No secret value, authentication URL, publishable key, JWT, password, session,
or synthetic identity is retained here.

## Local verification

| Gate | Result |
|---|---|
| Frozen dependency install | Pass; offline and lockfile-frozen |
| Full offline UAT gate | Pass; 152 ops tests, 273 UI tests, production build, 37 Playwright passed and 35 intentionally skipped |
| Focused infrastructure contract | Pass; 14 tests |
| Full operations gate after authenticated-smoke tooling | Pass; 8 files and 166 tests |
| Tracked secret scan | Pass; 159 files |
| Shell syntax | Pass for both UAT lifecycle scripts |

## Evidence still required

No claim is made yet for container health, a new PostgreSQL system identifier,
the 18-row live migration journal, live Auth/session behavior, PostgREST/RLS
rejection, restrictive remote file modes, unchanged before/after development
state during mutation, or private HTTPS. Those items require a fresh successful
`preflight`, followed by `sync`, `provision`, and `verify` on the approved host.

Ready for formal product UAT: **No**.
