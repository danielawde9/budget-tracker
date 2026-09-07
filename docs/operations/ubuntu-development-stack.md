# Budget Ubuntu development stack

Budget runs only from `/home/daniel/budget-supabase` on
`daniel@100.124.228.75`. The Mac repository is authoritative; only the
`supabase/` directory is copied to the remote host using SSH secure copy.

Use these commands:

```bash
./scripts/remote-supabase.sh start
./scripts/remote-supabase.sh status
./scripts/remote-supabase.sh reset
./scripts/remote-supabase.sh disable-restart
```

Budget uses ports 54421 through 54424, with shadow, pooler, and analytics
ports 54420, 54429, and 54427 respectively. This avoids the Sandooq range
54321 through 54324.

Budget containers must use Docker restart policy `no`, matching the Sandooq
Supabase containers. They are started only on explicit request and must remain
stopped after an Ubuntu reboot. The lifecycle script enforces this after each
explicit start; `disable-restart` reapplies it to a currently running stack.
Immich and AdGuard are separate host services and are out of scope.

Before the first `start`, configure host-level restrictions so these ports are
reachable only through Tailscale. This has been verified on the current host:
UFW defaults to denying inbound traffic, allows the `tailscale0` interface, and
the Docker `DOCKER-USER` chain drops traffic arriving from `enp1s0`. Recheck
those rules before any host-network change. `reset` applies only to
`/home/daniel/budget-supabase`; it must never target the Sandooq project.

## Verified database-test target

On 2026-09-07, the reachable Budget database endpoint was confirmed as the
Tailscale host on port `54422`; PostgreSQL reported system identifier
`7682772744672088101` and server version number `170006`. Its Budget containers
were verified with restart policy `no`.

The migration journal was proved both from an empty schema and as a seeded
upgrade: reset through `20260907146000`, insert a minimal Budget-only journal
seed, run `supabase migration up --local`, then verify the seed event and
movement remained while migration history advanced to `20260907147000`.
Connection strings and credentials remain in ignored local test configuration.

The independent Loans audit repeated this proof without resetting the live
Budget schema: a disposable database on the same Budget PostgreSQL cluster
applied the first 11 migrations through `20260907146000`, retained one seed
event and wallet movement with amount `4242`, and advanced to 14 migrations
through `20260907149000`. The disposable database was dropped after proof.

An independent audit later on 2026-09-07 confirmed the configured Budget
endpoint, PostgreSQL `170006`, and migration journal, but the live cluster now
reports system identifier `7682837243973648421`. This supersedes the earlier
identifier above for current database-operation checks; a recreated PostgreSQL
cluster receives a new identifier even when the Budget host and port stay the
same.
