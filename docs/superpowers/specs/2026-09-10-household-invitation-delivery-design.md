# Household invitation delivery design

## Status and scope

This design adds one server-side delivery boundary for the existing protected
Household invitation lifecycle. It starts from release commit `4018d81` and does
not change the membership schema, command bodies, authorization, financial
behavior, browser Household UI, or hosted state.

The boundary creates an invitation through the existing
`public.create_household_invitation(uuid, uuid, text)` RPC using the caller's
Supabase access token, then delivers one transactional invitation through
Resend. It never sends email directly from Vite or exposes a provider credential
to browser code.

No real email, provider setting, secret, DNS record, migration, deployment, or
production-data operation is authorized by this milestone.

## Chosen architecture

Add a Cloudflare Worker module beside the existing static-assets deployment.
The Worker serves the current built SPA through its assets binding and handles
one API route:

```text
POST /api/household-invitations/deliver
```

The route is a small composition layer over injected ports:

- a Supabase invitation-command client;
- a Resend transactional-email adapter;
- two Cloudflare rate-limit bindings;
- a clock and bounded sleep function;
- a redacted audit sink.

The core delivery service and templates remain runtime-neutral TypeScript so
Vitest can exercise them without network access or real credentials. The Worker
entry point only translates HTTP requests and environment bindings into that
core contract.

This is preferred over a Supabase Edge Function because the application already
has a reviewed Cloudflare deployment path and should not gain a second runtime
and release procedure for one endpoint. A library with no runtime entry point
would be easier to test but would not establish a usable secret-custody boundary.

## Request and response contract

The endpoint accepts only `application/json` with a body no larger than 4 KiB:

```ts
type DeliverHouseholdInvitationRequest = {
  spaceId: string;
  requestId: string;
  inviteeEmail: string;
  locale: 'en' | 'ar';
};
```

`spaceId` and `requestId` must be canonical UUIDs. `inviteeEmail` is trimmed only
for transport validation and is limited to the database command's existing
254-byte UTF-8 boundary. The database remains authoritative for normalization,
identity matching, duplicate prevention, and owner authorization. The Worker
does not implement a competing membership rule.

The endpoint requires one `Authorization: Bearer <Supabase access token>` header.
It rejects missing, repeated, malformed, or oversized headers and never includes
the header value in an error or audit event. Only the configured application
origin receives CORS response headers. `OPTIONS` is bounded to the same route;
all other API methods and paths fail closed.

Success returns HTTP 200 with only:

```ts
{
  invitationId: string;
  expiresAt: string;
  delivery: 'accepted';
}
```

The response does not contain the invitation token, recipient address, Resend
message ID, or acceptance URL. Validation failures use 400, authentication and
authorization failures preserve generic 401/403 categories, rate limiting uses
429, upstream permanent failures use 502, transient exhaustion uses 503, and
unexpected failures use a generic 500. Public errors never reproduce upstream
messages or submitted values.

## Data flow and authorization preservation

1. The Worker enforces method, route, origin, content type, header, and body-size
   bounds before parsing JSON.
2. It validates the four request fields without logging their values.
3. An IP-scoped rate limiter runs before the database call.
4. The Worker extracts a syntactically valid JWT `sub` only to form a hashed,
   non-reversible throttle key. It does not trust that claim for authorization.
5. An actor-and-space rate limiter runs before the database call.
6. The command adapter calls the existing RPC with the same bearer token and the
   public Supabase publishable key. PostgreSQL and Supabase Auth remain the only
   authorities for identity, ownership, household kind, duplicates, and replay.
7. On command success, the service derives the deterministic Resend idempotency
   key from the returned invitation UUID and builds the acceptance URL.
8. The Resend adapter submits one HTML-and-plain-text transactional email with a
   bounded timeout and retry policy.
9. The raw token, recipient email, authorization header, and acceptance URL fall
   out of scope when the request ends and are never returned or audited.

The Worker receives no service-role key and no direct table privilege. It cannot
accept or cancel an invitation, read invitation tables, or mutate membership.
Provider acceptance means only that Resend accepted the delivery request; it is
not proof of inbox delivery or membership acceptance.

## Secrets and configuration

The Worker requires these server-side bindings:

- `SUPABASE_URL`: the credential-free HTTPS project origin;
- `SUPABASE_ANON_KEY`: the browser-safe publishable key used with the caller JWT;
- `RESEND_API_KEY`: a sending-only Resend secret;
- `HOUSEHOLD_INVITATION_FROM`: a sender on an approved verified domain;
- `HOUSEHOLD_INVITATION_REPLY_TO`: a monitored reply address;
- `APP_ORIGIN`: the canonical HTTPS application origin;
- `HOUSEHOLD_INVITATION_IP_LIMITER`: the IP-scoped rate-limit binding;
- `HOUSEHOLD_INVITATION_ACTOR_LIMITER`: the actor-and-space rate-limit binding;
- `ASSETS`: the existing static-assets binding.

Only binding names and non-sensitive binding declarations are committed.
Secret values, provider identifiers, account identifiers, and live hostnames stay
out of Git and out of Vite-prefixed variables. Startup validation reports only
the invalid binding name, never its value.

## Abuse controls and resource bounds

The public boundary applies two independent fail-closed limits:

- at most 20 delivery requests per source IP per minute;
- at most three delivery requests per authenticated subject and household space
  per minute.

Rate-limit keys are SHA-256 digests with domain-separated prefixes. Raw IPs,
JWT subjects, bearer tokens, space IDs, and recipient addresses are not sent to
the audit sink. A missing rate-limit binding or binding error rejects delivery;
it does not silently bypass the guard.

The request body is capped at 4 KiB, email content is generated from fixed
templates, every array is fixed-size, retries are bounded, and there is no queue
or unbounded in-memory accumulation. This milestone intentionally does not add a
durable application queue or a delivery-status table.

## Idempotency, timeouts, and retries

The provider idempotency key is:

```text
household-invitation/<invitation UUID>
```

An exact database-command replay returns the same invitation UUID and token, so
every transport retry within the provider window uses the same key and payload.
The service makes at most three Resend attempts. Each attempt has a ten-second
deadline. Retry delays are bounded exponential backoff with injected jitter,
capped so the entire handler remains bounded. Only network/timeout failures,
HTTP 429, and HTTP 5xx responses retry. Validation, authentication, forbidden,
idempotency-conflict, and other 4xx responses fail immediately.

Resend idempotency lasts 24 hours. To avoid a possible duplicate after that
window, the service derives the invitation creation time from the fixed seven-day
expiry and refuses a provider retry once the invitation is 23 hours old. The
public response then reports an ambiguous delivery state and instructs the later
UI to cancel and replace the invitation rather than silently resend it. The
clock-skew safety margin is one hour.

If the database commit succeeds and email delivery fails, the pending invitation
remains cancellable. A retry must reuse the same `requestId`, `spaceId`, email,
and locale. The boundary never creates a replacement automatically.

## Resend adapter

The adapter uses Resend's single-email HTTP endpoint through injected `fetch`.
Using the narrow HTTP contract avoids importing a provider SDK into browser code
or coupling the core service to provider classes. It always sends:

- one recipient;
- an approved `from` value and monitored `reply_to`;
- a locale-specific subject;
- both HTML and plain-text bodies;
- the deterministic idempotency header;
- fixed non-sensitive tags for the invitation email type and locale.

The adapter parses a bounded response body and maps only status/category and a
validated provider message ID into internal results. Provider error text is
discarded. Tests inject fetch responses and abort behavior; no test contacts
Resend.

## Bilingual email content

English and Arabic are separately authored transactional templates, not machine
translations at send time. Both state the household invitation purpose, the
seven-day expiry, the primary action, and the recovery path for an unexpected
invitation. Neither exposes internal IDs.

HTML includes a specific `<title>`, one `<h1>`, descriptive link text, and
`lang`/`dir` on `<html>` and the body's direct content wrapper. English uses
`lang="en" dir="ltr"`; Arabic uses `lang="ar" dir="rtl"`. Layout remains a
single mobile-first column, uses logical alignment, has no images, and gives the
action link a minimum 44-pixel target with AA text contrast. A plain-text version
contains the same meaning and a labeled acceptance URL.

The acceptance link uses HTTPS and carries the invitation token only after the
fragment delimiter:

```text
<APP_ORIGIN>/#household-invitation=<URL-encoded token>
```

Fragments are not sent to the origin in HTTP requests. The later Household UI
must clear the fragment before any render or network request, as required by the
membership design. This milestone does not implement that UI.

## Redacted audit events

The core emits a fixed union of structured events:

- request rejected by category;
- request rate limited by scope;
- invitation command accepted or rejected by safe category;
- provider attempt started;
- provider attempt retry scheduled;
- provider accepted;
- provider failed permanently or exhausted retries.

Events contain only a timestamp, fixed event name, fixed outcome/reason enum,
attempt number where relevant, and hashed correlation keys. They never contain
request bodies, headers, email addresses, tokens, URLs, JWT claims, raw IPs,
provider error text, or arbitrary exception messages. Source-ratchet tests scan
the delivery files for sensitive values flowing to console, logger, analytics,
or response sinks.

## Test-first verification

Implementation proceeds in red-green commits:

1. Pure tests define request validation, body/header bounds, route/method/CORS
   behavior, and fail-closed binding validation.
2. Service tests define exact RPC forwarding, stable replay, retry classification,
   three-attempt and timeout bounds, 23-hour cutoff, and post-commit failure
   behavior with injected adapters and clock.
3. Adapter tests define the exact Resend request, explicit HTTP error handling,
   bounded response parsing, abort behavior, and redaction without network calls.
4. Template tests snapshot semantic EN/AR HTML and text, verify accessibility
   attributes, token-in-fragment placement, escaping, and absence of PII from
   subjects and audit output.
5. Contract tests prove Worker configuration has a module entry point, assets
   binding, rate-limit bindings, and no committed secret or `VITE_RESEND_*` path.
6. Existing typecheck, UI, build, ops, database, and source-ratchet suites remain
   green. Real PostgreSQL tests prove the existing commands were not weakened;
   they do not claim a live Resend send.

No verification step uses a real provider address, API key, hosted binding, or
production account.

## Live-send approval boundary

Before any live send, a responsible owner must separately approve and configure:

1. the exact Resend sending domain and sending-only API key;
2. SPF, DKIM, and DMARC records plus monitoring;
3. the exact `from`, monitored reply-to, and public application origin;
4. Cloudflare secret values and both rate-limit bindings;
5. transactional click/open tracking disabled for the sending domain;
6. deployment of the reviewed commit and a synthetic-address smoke test;
7. the later Household acceptance UI that clears the token fragment safely;
8. bounce, complaint, suppression, and operational-alert handling before wider
   release.

Those are configuration, deployment, provider, UI, and operational approvals.
They are not implied by code review, tests, commit creation, or merge approval.

## Deferred work

Household management UI, token acceptance UI, delivery webhooks, durable queues,
delivery-status persistence, provider dashboards, DNS changes, suppression
automation, custom domains, deployment, and real-email evidence remain separate
milestones. None may alter or bypass the protected membership commands.
