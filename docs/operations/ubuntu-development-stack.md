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
