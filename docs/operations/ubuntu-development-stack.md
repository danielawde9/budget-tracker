# Budget Ubuntu development stack

Budget runs only from `/home/lelabo/budget-supabase` on
`lelabo@100.76.160.91`. The Mac repository is authoritative; only the
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

The pinned Supabase CLI binds its published ports to all host interfaces. The
installed `budget-tailnet-firewall.service` therefore permits the Budget range
from Tailscale addresses and drops new connections arriving from every other
interface in Docker's `DOCKER-USER` chain. Install the tracked files with:

```bash
scp ops/ubuntu/budget-tailnet-firewall.sh \
  lelabo@100.76.160.91:/tmp/budget-tailnet-firewall
scp ops/ubuntu/budget-tailnet-firewall.service \
  lelabo@100.76.160.91:/tmp/budget-tailnet-firewall.service
ssh -t lelabo@100.76.160.91
sudo install -o root -g root -m 0755 /tmp/budget-tailnet-firewall \
  /usr/local/sbin/budget-tailnet-firewall
sudo install -o root -g root -m 0644 \
  /tmp/budget-tailnet-firewall.service \
  /etc/systemd/system/budget-tailnet-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now budget-tailnet-firewall.service
```

The lifecycle refuses `start` and `reset` unless this service is active. Never
replace or remove the existing Sandooq mappings on ports 54321 through 54324.
`reset` applies only to `/home/lelabo/budget-supabase`; it must never target the
Sandooq project.

## Verified database-test target

On 2026-09-07, the original Budget database endpoint was confirmed on the
previous Tailscale host at port `54422`; PostgreSQL reported system identifier
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

An independent audit later on 2026-09-07 confirmed that original Budget
endpoint, PostgreSQL `170006`, and migration journal, but the cluster then
reports system identifier `7682837243973648421`. This supersedes the earlier
identifier for historical checks only. The current Le Labo Ubuntu identity is
recorded after its first verified start because a recreated PostgreSQL cluster
receives a new identifier.

On 2026-09-08, the replacement stack at `100.76.160.91` reported PostgreSQL
`170006`, system identifier `7683090997378195493`, and all 14 committed
migrations. The Budget database suite passed 28 tests. Ports 54421–54424 were
reachable through the Tailscale address and rejected connections through both
host LAN addresses. The firewall service was enabled and active, every Budget
container used restart policy `no`, and both existing POS database containers
remained healthy.

On 2026-09-08, the Categories v1 foundation advanced only the Budget journal
from 14 migrations through `20260907149000` to 17 migrations through
`20260908102000`. The three forward-only files add the foundation, harden null
and statement-delete boundaries, and re-collapse internal whitespace after
Arabic mark removal. Their tracked and synchronized SHA-256 values were,
respectively, `313878714f44a26fa0ff659c16662a9bc34330fb72d68623f0f59f12df76a50a`,
`fd7131ce48c2844fc62d616053a7d6cadb285e85b6e13da21a907669d98a899f`, and
`bee7904590f8bbb6641429d1f4e2847f7bc2a141e6be0ab5f3d6248c599de622`.
The target remained PostgreSQL `170006` with system identifier
`7683090997378195493`.

Disposable from-empty and seeded-upgrade databases on the same dedicated
Budget cluster proved the full 17-file journal and the 14-to-17 upgrade. The
seeded comparison retained identical contents for all 10 pre-existing tables
and views, plus all 30 pre-existing relation-grant and 40 existing
function-grant checks, with zero category backfill. A separate 16-to-17 proof
recomputed `دخل  اضافي` as `دخل اضافي`, rejected the resulting duplicate, and
restored the temporarily disabled archive guard. One category request and one
category row created by the intentional red test were removed before adding the
nonempty-key constraint; the row had no financial association. The disposable
proof databases were dropped afterward.

The post-application catalog has three member-readable/RLS-protected tables,
three statement-level DELETE guards, no direct write privileges for `anon`,
`authenticated`, or `service_role`, and no blank, stale, or colliding active
Arabic keys. The final gate passed 57 database tests, 107 UI tests, the
production build, and 23 applicable Playwright scenarios with 23 intentional
project skips. No Categories UI, hosted, production, POS, Sandooq, or deployment
operation was part of this change.
