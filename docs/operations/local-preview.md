# Local preview (v2 connected money model)

The preview runs entirely on this computer. A private Supabase stack runs in
Docker with the v2 migrations and sample data, and the app is served by Vite
on `http://127.0.0.1:5173`. It never talks to the hosted production project,
the shared Tailscale dev database, or Cloudflare.

## Start

```bash
pnpm preview:up
pnpm demo
```

`pnpm preview:up` runs `scripts/preview/up.sh`, which:

1. starts a minimal Supabase stack (Postgres, Auth, REST, gateway) with
   `supabase start` using `supabase/config.toml`, project `budget-v2-preview`;
2. resets the local database to `supabase/migrations` (`--local`, never `--linked`);
3. writes `.env.demo.local` (gitignored) with the local URL and the local anon key;
4. runs `scripts/preview/seed.ts`. The seed creates the two demo users through the
   local Auth admin API, signs in as the story user, and runs
   `scripts/preview/scenario.ts` through the same public functions the app calls.

Both the seed and the app (in `demo` mode) refuse any backend that is not on a
loopback address.

Open `http://127.0.0.1:5173` and use the **Local preview** buttons:

- **Existing money (demonstrations 2–10).** Two months of activity: an opening
  balance in the previous month, then the current month up to day 3.
  **Settings → Guided tour** links each demonstration to the screen that shows it.
- **Fresh start from zero (demonstration 1).** This user has no space yet, so it
  goes through onboarding.

The demo identities are listed in `scripts/preview/demo-accounts.ts`. They only
exist in the local container.

## Reset

Run `pnpm preview:up` again. It resets the local database and reseeds it in
about 15 seconds once the Docker images are cached.

## Stop

```bash
supabase stop
```

The Vite server stops with Ctrl+C. If the desktop app started it as
`budget-v2-demo`, stop it from the preview pane.

## Tests that use the preview

- `pnpm test:e2e` (Playwright, installed Chrome) drives real flows against this
  stack. Each test creates its own throwaway user. If the stack is not running,
  the tests are skipped and reported as unverified.
- `pnpm test:db` does not use this stack. It starts its own Postgres 17.6
  (Supabase image) with Testcontainers.
