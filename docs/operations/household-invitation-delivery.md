# Household invitation delivery runbook

This runbook covers the server-side Resend boundary for existing protected
Household invitations. Repository tests use injected adapters and do not contact
Supabase, Resend, or Cloudflare. This runbook does not authorize a live send,
deployment, DNS change, provider change, hosted secret change, migration, or
production-data access.

## Verified code boundary

`POST /api/household-invitations/deliver` accepts one bounded request from the
configured application origin. The Worker applies a 20-per-minute source limit
and a three-per-minute owner-and-household limit, then forwards the caller's
bearer token to the existing `public.create_household_invitation` RPC. It has no
service-role key, direct Household table write, acceptance command, or financial
capability.

The returned token exists only in request-local memory and the Resend payload.
The provider idempotency key is derived from the invitation UUID. Each provider
attempt has a ten-second timeout, transient errors receive at most two bounded
backoffs, and a request makes at most three attempts. A replay is refused once
the invitation is 23 hours old so it cannot silently cross Resend's 24-hour
idempotency window.

English and Arabic messages include HTML and plain-text bodies. The acceptance
token appears only in the URL fragment. No real email is sent by repository
verification.

## Required Worker bindings

The committed Wrangler configuration declares these required secrets by name;
their values must never be committed, printed, placed in command arguments, or
prefixed with `VITE_`:

- `APP_ORIGIN`: exact public HTTPS application origin;
- `SUPABASE_URL`: exact credential-free HTTPS Supabase project origin;
- `SUPABASE_ANON_KEY`: the project publishable key used with the caller JWT;
- `RESEND_API_KEY`: a sending-only Resend API key;
- `HOUSEHOLD_INVITATION_FROM`: approved sender on the verified sending domain;
- `HOUSEHOLD_INVITATION_REPLY_TO`: monitored reply address.

The configured `ASSETS` binding preserves the Vite SPA. Rate-limit namespace
IDs `91001` and `91002` are repository defaults only. Before deployment, the
Cloudflare account owner must confirm they do not collide with another Worker
namespace. Changing them requires regenerating `worker-configuration.d.ts` and
rerunning the complete Worker and deployment contract tests.

Do not run `wrangler secret put` during code verification: that command creates
and immediately deploys a Worker version. Secret creation is a separately
approved hosted operation. Use the owner-approved staged versions workflow or
dashboard procedure only during an authorized release.

## Provider and domain approvals

Before the first live send, a responsible owner must approve all of the
following as one exact release target:

1. The Resend account, exact sending domain, and sending-only Resend API key.
2. Verified SPF, DKIM, and DMARC records, plus an owner for DMARC monitoring.
3. The exact sender name/address and monitored reply address.
4. Open and click transactional tracking disabled on the sending domain.
5. The exact public `APP_ORIGIN`; its domain must align with the sender's trust
   boundary and the acceptance route must use HTTPS.
6. Cloudflare secrets, unique rate-limit namespaces, reviewed commit, and target
   Worker account/environment.
7. A single owner-approved synthetic Resend address such as
   `delivered@resend.dev` for the first smoke test; never invent a mailbox at a
   real provider.
8. An operational owner and tested response for bounce, complaint, and
   suppression events before invitations are opened beyond the synthetic test.

No unsubscribe link is added because this is an expected one-to-one
transactional invitation, not marketing mail. A future marketing use requires a
separate consent and compliance design.

## Application approval still required

This milestone deliberately adds no Household gateway or interface. A live send
must wait for a separately reviewed Household acceptance UI that:

- reads the token from `#household-invitation=...` into one local variable;
- removes the fragment before any render, logging, analytics, or network call;
- submits only through the protected acceptance command;
- gives wrong-account, expired, cancelled, and consumed invitations the same
  safe recovery message;
- works in English, Arabic RTL, keyboard navigation, and narrow mobile layouts.

Sending a message before that UI exists would give the recipient a link that
cannot be consumed safely, so provider configuration alone is not launch
approval.

## Offline verification

Run only the local, network-free checks without secret values:

```bash
pnpm install --frozen-lockfile
pnpm check:worker-types
pnpm test:worker
pnpm typecheck
pnpm deploy:cloudflare:dry-run
```

The dry run packages the Worker and current static assets. It does not validate
hosted secret values, namespace uniqueness, provider delivery, inbox placement,
the future acceptance UI, or deployment. Do not run `pnpm deploy:cloudflare` as
part of this verification.

## Authorized future smoke test

Only after every approval above and deployment of the reviewed commit:

1. Use a synthetic owner and synthetic Household with no real financial data.
2. Submit one invitation to the approved synthetic Resend address.
3. Confirm the Worker audit contains only fixed event names, attempt numbers,
   fixed reason categories, timestamps, and hashed correlation keys.
4. Confirm provider acceptance separately from inbox delivery and separately
   from membership acceptance.
5. Verify the fragment is cleared before the acceptance request and that the
   protected RPC creates membership for the intended confirmed account only.
6. Exercise the bounce and complaint procedure before expanding access.

A code test, dry run, provider-accepted response, inbox delivery, and membership
acceptance are five different pieces of evidence. Record them separately.
