# Supabase household invitation delivery

The browser calls `https://<configured-project>/functions/v1/household-invitations`
with the current user's JWT and the public client key. Cloudflare hosts only the
static frontend. The function verifies the user with Supabase Auth, consumes
persistent rate limits, calls `create_household_invitation` as that user, and
sends the existing English or Arabic email via Resend. No invitation token is
returned to the browser or written to logs. Tokens appear only in email URL
fragments and are consumed by the existing acceptance UI.

## Deployment

The current production Budget project is `dfuxxzlhmxscgvxdmwti`. Confirm that
`.env.local` selects this same project before deploying. Older runbooks and
`supabase/.temp/project-ref` may still name a deleted project; always pass this
project ref explicitly to the CLI.

Apply `supabase/migrations/20261003120000_household_invitation_delivery_limits.sql`
and `supabase/migrations/20261003121000_restore_household_extension_usage.sql`
through the approved SQL migration process and record their versions in the
migration journal. The second restores the invitation command role’s existing
extension-schema access needed by UUID generation after hosted permission drift. Avoid applying unrelated pending migrations. The migration
adds a private counter table and an authenticated, owner-scoped command. Counters
reset each minute and are serialized per user, allowing three attempts per
household and twenty across all households. Unauthenticated callers, members,
revoked owners, and personal spaces are rejected before counter writes.

Set these server-side Edge Function secrets through an ignored environment
file or Supabase Dashboard; never commit or print their values:

- `APP_ORIGIN`: exact HTTPS frontend origin used in email links and CORS.
- `APP_ALLOWED_ORIGINS`: optional comma-separated HTTPS aliases, such as the
  configured workers.dev hostname. Email links always use `APP_ORIGIN`.
- `RESEND_API_KEY`: the existing email sending key.
- `HOUSEHOLD_INVITATION_FROM`: sender on a Resend-verified domain.
- `HOUSEHOLD_INVITATION_REPLY_TO`: the operator's monitored email address.

Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The function uses the
caller JWT for database commands and has no need for a privileged key.

```bash
supabase secrets set --project-ref dfuxxzlhmxscgvxdmwti --env-file /path/to/ignored/invitation-secrets.env
supabase functions deploy household-invitations --project-ref dfuxxzlhmxscgvxdmwti --use-api
pnpm deploy:cloudflare:frontend
```

Keep `verify_jwt = true` in `supabase/config.toml`. The handler separately verifies
a real user through Auth, since API keys must not stand in for user identities.
Shared delivery modules live in `supabase/functions/_shared/household-invitations`.
The legacy Worker imports those modules instead of maintaining a second copy.

## Verification

```bash
deno check supabase/functions/household-invitations/index.ts
pnpm test:worker
pnpm exec vitest run --config vitest.ui.config.ts src/features/household src/lib/supabase.test.ts src/app.test.tsx
pnpm exec vitest run tests/db/household-delivery-limits.integration.test.ts --pool=forks --no-file-parallelism
pnpm typecheck
pnpm build:cloudflare
```

Database tests require a disposable local PostgreSQL server configured through
`BUDGET_TEST_DATABASE_URL`. Repository tests inject the email adapter and do not
send email. A live smoke test should use an empty synthetic household and
`delivered@resend.dev`, preserving separate evidence for provider acceptance,
invitation acceptance, and the deployed frontend. No customer financial records
are needed for verification. Check CORS preflight, rejected authentication,
rate limiting, and safe response fields as well as success.
