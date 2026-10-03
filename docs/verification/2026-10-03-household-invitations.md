# Household invitation release — 2026-10-03

Invitation delivery now runs in the authenticated Supabase Edge Function on
Budget Tracker project `dfuxxzlhmxscgvxdmwti`. The browser calls it directly;
Cloudflare continues to host the static frontend. Email links use
`https://budget.danielawde9.com`; its existing workers.dev alias is also allowed
by the exact CORS allowlist. The existing configured Resend sending domain was
verified before release. Server secrets were configured without printing or
committing their values.

Two targeted production migrations were applied and journaled:

- `20261003120000`: private, atomic invitation rate counters.
- `20261003121000`: restores the household command role's original extension
  schema usage grant needed by UUID generation. Live verification found that
  this grant was missing on the hosted baseline. No Auth table, invitation key,
  or financial write permission was added by the repair.

Local checks passed: 107 backend tests, 113 application/household tests, eight
PostgreSQL integration tests, five deployment contract tests, TypeScript checks,
Deno type checks, the production Vite build, and the frontend deployment dry run.
The SQL regression explicitly removes extension access, proves invitation
creation fails, restores access, and proves creation succeeds. The concurrency
check proves only one concurrent request can consume the last available attempt.
The compiled browser artifact was checked for the Supabase function endpoint
and the absence of the Resend key.

Live checks passed on the deployed function: exact-origin preflight, rejected
invalid authentication, provider acceptance at the synthetic Resend sink,
idempotent replay, persistent rate limiting, invitation acceptance, and the
recipient leaving through the normal command. An empty, explicitly labelled
synthetic household and synthetic Auth accounts were used; no customer financial
records were needed. This proves provider acceptance and membership acceptance;
it does not assert placement in a human recipient's inbox.

The sidebar, mobile navigation, brand, and space-switcher icons now retain
Lucide's outline paths. The rule that filled these icons was removed.
