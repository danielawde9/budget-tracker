# Household invitation delivery UI design

## Status and scope

This document extends the merged household membership UI
(`2026-09-10-household-membership-ui-design.md`) and the merged invitation
delivery boundary (`2026-09-10-household-invitation-delivery-design.md`). It
starts from `main` commit `a8c6084`.

The browser invite flow today creates a dead record: it calls
`public.create_household_invitation` directly, discards the returned token at
the gateway, tells the owner "Delivery is not configured", and lists a bare
invitation UUID that reads like a shareable link but opens nothing. The
reviewed Cloudflare Worker endpoint `POST /api/household-invitations/deliver`
exists and is tested, yet no browser code calls it. There is also no resend
path for an owner who needs to re-deliver an invitation.

This milestone wires the browser invite flow to the delivery boundary, adds a
resend action, and removes the misleading UUID presentation. It does not
change the membership schema, commands, authorization, projections, the
Worker handler, templates, rate limits, or any financial surface. It does not
send real email: live sending still requires the separately owner-gated
provider configuration from the delivery design.

## Chosen experience

### Invite dialog delivers

The `Invite member` dialog keeps one email field, but submitting now calls
the same-origin Worker endpoint with the caller's Supabase access token. The
Worker creates the invitation through the protected RPC and delivers the
token link by email. Success copy names the address: "Invitation sent to
<x>." No token, link, or provider identifier is rendered, copied, or stored.

When delivery is unavailable (endpoint absent, as in local Vite dev), the
owner sees a generic, localized "not available in this environment" message;
no record is created and nothing needs cancelling.

### Send again is the resend path

After success the dialog keeps the address, disables the field, and changes
the primary action to `Send again`. Resubmitting reuses the same request ID,
so the database replays the identical invitation (the token is derived from
the request ID) and the Worker re-delivers it within the provider
idempotency window. After the 23-hour window the Worker reports an ambiguous
delivery state and the UI instructs the owner to cancel the pending
invitation and create it again.

The invitation projection stays identity-free by design, so resend cannot
start from a list row; it starts from the dialog with the address the owner
typed. Re-entering an address that already has a pending invitation in a new
dialog produces a safe conflict message that names no identity and points at
cancel-then-recreate.

### Register without the fake link

Invitation rows stop showing the raw invitation UUID. A row is status plus
created/expires dates, with `Cancel invitation` for pending or expired rows.
The opaque UUID remains only inside the cancel confirmation, matching the
member roster convention of naming the affected identifier in confirmations.

## Application boundaries

New focused module `src/features/household/invitation-delivery.ts`:

- `InvitationDelivery.deliverInvitation({spaceId, requestId, email, locale})`
  returns `{invitationId, expiresAt}`.
- `createHttpInvitationDelivery({fetch, getAccessToken, timeoutMs?, baseUrl?})`
  posts JSON to `${baseUrl}/api/household-invitations/deliver` with one
  bearer authorization header and a bounded timeout. The default `baseUrl`
  is the empty string (same origin, matching the Worker assets deployment).
- Success validates the response shape (UUID, timestamp). Failures throw
  `HouseholdInvitationDeliveryError` carrying only the Worker's safe error
  code and HTTP status. Client-side network and timeout failures use the
  dedicated `network_error` code. The client never logs tokens, addresses,
  or headers, and reads bounded response bodies.

`src/features/household/delivering-household-gateway.ts` composes the port:

- `createDeliveringHouseholdGateway(base, delivery)` delegates every read
  and non-create mutation to the base Supabase gateway and overrides only
  `createInvitation`, forwarding `spaceId`, `requestId`, `email`, and the
  new `locale` input. The browser no longer calls
  `create_household_invitation` directly when delivery is composed.

`types.ts` gains `locale: 'en' | 'ar'` on the create input. `use-household`
passes the page locale through and retains the create intent's request ID
after success so `Send again` is a true idempotent replay; every other
mutation keeps the existing new-ID-after-success behavior.

Composition in `app.tsx` wraps only the composed Supabase gateway (never an
injected test gateway) with the HTTP delivery client. The bearer token comes
from `client.auth.getSession()`; `RawSession` gains the required
`access_token` field it already carries at runtime.

## Error mapping

`errors.ts` classifies `HouseholdInvitationDeliveryError` without exposing
transport or identity detail:

- `invalid_authorization` -> existing `access-lost`
- `rate_limited` -> new `rate-limited` (wait, then Send again)
- `delivery_status_ambiguous` -> new `invitation-ambiguous` (cancel and
  recreate)
- `invitation_command_rejected` -> new `invitation-conflict` (an invitation
  may already be pending; cancel then recreate)
- `not_found`, `invalid_configuration`, `origin_rejected` -> new
  `delivery-unavailable` (environment is not configured for delivery)
- all remaining transient codes -> existing `request-failed`

English and Arabic copy stay generic and never reproduce submitted values.

## Testing

Red-green unit coverage: delivery client request shape, response validation,
every error-code mapping, timeout and network failure, missing session token;
decorator delegation and create override; new error classifications and
Arabic parity; hook request-ID retention for resend and locale pass-through;
dialog send-again flow and register copy. The e2e fixture simulates the
Worker boundary (verifies bearer, records deliveries, still records the one
protected RPC) and the visual spec asserts the delivered state, the resend
reuse of one request ID, and absence of any rendered token.

## Deferred work

Delivery-status persistence, per-row resend (requires an identity-bearing
projection and schema work), webhooks, live provider configuration, and
hosted deployment remain separate owner-gated milestones.
