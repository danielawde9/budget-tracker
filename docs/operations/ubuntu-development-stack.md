# Budget Ubuntu development stack

Budget runs only from `/home/daniel/budget-supabase` on
`daniel@100.124.228.75`. The Mac repository is authoritative; only the
`supabase/` directory is synchronized to the remote host.

Use these commands:

```bash
./scripts/remote-supabase.sh start
./scripts/remote-supabase.sh status
./scripts/remote-supabase.sh reset
```

Budget uses ports 54421 through 54424, with shadow, pooler, and analytics
ports 54420, 54429, and 54427 respectively. This avoids the Sandooq range
54321 through 54324.

Budget containers must use Docker restart policy `no`, matching the Sandooq
Supabase containers. They are started only on explicit request and must remain
stopped after an Ubuntu reboot. Immich and AdGuard are separate host services
and are out of scope.

Before the first `start`, configure host-level restrictions so these ports are
reachable only through Tailscale. Do not start Budget while the ports are open
to the LAN or Internet. `reset` applies only to `/home/daniel/budget-supabase`;
it must never target the Sandooq project.
