# Household Membership Security Design

## Status and scope

This document specifies the protected database and future application contracts
for household invitations and membership management. It is a design only. It
does not authorize or implement SQL, application code, email delivery, UI,
deployment, or changes to `docs/decisions.md`.

The design starts from repository commit `59c2cb4`. The existing personal and
household space model, authenticated shell, visible-space selection, workspace
gateway, RLS policies, and financial command inventory remain the integration
boundary. No financial table, financial command, balance projection, or Loans or
Wallets gateway is changed by this design.

The objective is to let an owner invite and manage people in a household space
without creating a path into any personal space, weakening RLS, exposing reusable
invitation secrets at rest, or allowing the browser to write membership tables.

## Existing boundary to preserve

- `public.create_space` creates a space and its initial owner membership in one
  transaction.
- `private.is_active_member(space_id)` is the shared authorization fact used by
  space RLS and the protected financial commands.
- Authenticated clients can select only their own `space_memberships` row and
  spaces made visible through the membership helper. They have no membership
  mutation policy or table write privilege.
- The application stores a selected space under the authenticated user ID and
  restores it only after a fresh RLS-visible space read.
- Authentication application state contains only user ID and optional email.
  Supabase owns session tokens and refresh behavior.
- Every actual-money and principal change remains behind the commands in
  `docs/financial-command-inventory.md`. Household administration is not a
  financial posting path and must not be added to that command inventory.

Adding membership state therefore requires replacing the helper's predicate
from "a row exists" to "an active row exists." Existing callers continue to use
the same helper signature and gain immediate fail-closed behavior for revoked or
left memberships.

## Approaches considered

### 1. Stateful database invitation plus current membership and immutable events

Store invitation lifecycle state and token digests in PostgreSQL, store current
membership state on the existing membership row, and append a non-PII event for
every accepted command. All mutations run through narrow protected commands.

This supports cancellation, fixed expiry, one-time acceptance, deterministic
idempotency, concurrent acceptance, reactivation after a new invitation, and
last-owner protection in the same transaction as the membership change. It also
fits the repository's existing protected-command and real-Postgres test model.

Cost: the database owns more explicit state and needs private HMAC keys plus
carefully ordered locking.

### 2. Supabase Auth administrative invitations as the membership primitive

Use provider invitation/account APIs and create a household membership after the
authentication callback.

This provides email transport, but it couples account provisioning, email
delivery, and household authorization. It requires a service-role caller,
creates ambiguous partial-success states between Auth and PostgreSQL, and does
not by itself provide household cancellation, last-owner, or command replay
semantics. It also makes provider email behavior part of the authorization core.

### 3. Stateless signed invitation links

Put the space, role, recipient identity, and expiry in a signed token and create
the membership when the link is presented.

This removes an invitation table but makes cancellation and one-time consumption
stateful again, complicates key rotation, and cannot safely answer concurrent
acceptance or replay without a consumed-token registry. Once that registry
exists, this is a less explicit version of approach 1.

### Recommendation

Use approach 1. It keeps authorization in PostgreSQL, where space membership is
already enforced, while treating future email as a replaceable delivery layer.
The alternatives move complexity out of view rather than remove it.

## Authorization model

### Roles and states

Keep the existing `public.member_role` values:

- `owner`: all active-member capabilities plus household administration.
- `member`: the same space and financial capabilities currently granted to any
  active member, but no invitation, removal, or role-management capability.

Add `public.membership_status` with exactly:

- `active`: participates in RLS and may use commands allowed by the role.
- `revoked`: access was ended by an owner.
- `left`: the member ended their own access.

Revoked and left rows remain as current-state history anchors but confer no read
or command access. Reaccepting a newly created invitation may reactivate either
state as `member`. Accepting or replaying an old, already consumed invitation
must never reactivate a membership.

This milestone has no viewer, read-only, child, or custom role. Adding one would
require a separate capability design because existing financial commands treat
every active member as a full financial participant.

### Capability matrix

| Capability | Active owner | Active member | Revoked or left | Authenticated new invitee | Anonymous or unrelated user |
| --- | --- | --- | --- | --- | --- |
| Read the household and its financial projections | Yes | Yes | No | No | No |
| Use existing household financial commands | Yes | Yes | No | No | No |
| Read own membership row | Yes | Yes | Own inactive row only | No row | No |
| List the complete member roster | Yes | No | No | No | No |
| List invitations | Yes | No | No | No | No |
| Create or cancel an invitation | Yes | No | No | No | No |
| Promote or demote a member | Yes | No | No | No | No |
| Remove another member | Yes | No | No | No | No |
| Leave the household | Yes, if another active owner remains | Yes | No | No | No |
| Accept a valid invitation addressed to the account | Not applicable while active | Not applicable while active | Yes, from a newly issued invitation | Yes | No |

Owners may not remove themselves through the owner-removal command; they use the
leave command so self-action and last-owner checks remain unambiguous.

### Personal-space prohibition

Every household invitation or membership command must lock and load the target
space, verify `kind = 'household'`, then authorize the caller. A personal space
must always have exactly one active membership, and that membership must be its
owner. It cannot have invitations, members, revoked member history, role changes,
removals, or a leave transition.

The prohibition is enforced in three layers:

1. Household commands reject a non-household space before any mutation.
2. Authenticated, anonymous, and background roles have no direct write privilege
   or RLS write policy on membership or invitation tables.
3. Deferred database invariants reject a personal-space invitation, a personal
   space with anything other than one membership row that is its active owner,
   or a household with no active owner.

## Proposed data model

Names below are normative for the implementation plan. The eventual migration
may add explicit constraint names, but it must not weaken these shapes.

### `public.space_memberships`

Retain the primary key `(space_id, user_id)`, existing foreign keys, `role`, and
`created_at`. Add:

| Column | Type | Rule |
| --- | --- | --- |
| `status` | `public.membership_status` | Not null; backfill and default existing rows to `active` |
| `activated_at` | `timestamptz` | Not null; backfill from `created_at`; command-generated with transaction-stable `now()` |
| `ended_at` | `timestamptz` | Null only while active; server-generated |
| `ended_by_user_id` | `uuid` | Nullable FK to `auth.users(id) ON DELETE RESTRICT` |

Required row checks:

- `active` requires both end columns to be null.
- `revoked` or `left` requires both end columns to be non-null.
- `left` requires `ended_by_user_id = user_id`.
- `revoked` requires `ended_by_user_id <> user_id`.
- `activated_at >= created_at` and `ended_at >= activated_at` when ended.

Reactivation updates `status`, `role`, and lifecycle timestamps on the current
row; it does not erase prior events. Direct row deletion is not an application
operation.

### `private.household_invitation_keys`

A private keyring contains `key_version smallint PRIMARY KEY`, separate random
32-byte `identity_hmac_key` and `token_hmac_key`, `created_at`, and nullable
`retired_at`. A partial unique index over a constant permits exactly one row
whose `retired_at IS NULL`. The first row is generated inside PostgreSQL during
migration; no key literal is committed. Checks require positive versions,
32-byte keys, and `retired_at > created_at` when retired.

No privilege is granted to `PUBLIC`, `anon`, `authenticated`, or `service_role`.
Only private security-definer helpers may read it. Invitations record the key
version used so acceptance and exact replay can use the correct private row.
Key rotation is a later operational procedure: normal rotation retains retired
versions for replay/audit needs; an incident rotation cancels all invitations
using a compromised version before destroying that key, after which replay of
those terminal creation requests returns unavailable rather than a token.

### `public.household_invitations`

Add `public.household_invitation_status` with `pending`, `accepted`, and
`cancelled`. Expiry is derived from `pending AND expires_at <= now()`; it does
not require a scheduled mutation.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid` | Primary key, server generated |
| `space_id` | `uuid` | FK to `spaces(id) ON DELETE RESTRICT` |
| `key_version` | `smallint` | FK to the private keyring; immutable after insert |
| `invitee_identity_digest` | `bytea` | 32-byte keyed HMAC; never an email address |
| `token_digest` | `bytea` | Unique 32-byte SHA-256 digest of the raw token |
| `status` | invitation enum | Not null, initially `pending` |
| `created_by_user_id` | `uuid` | FK to `auth.users(id) ON DELETE RESTRICT` |
| `created_at` | `timestamptz` | Server `now()` |
| `expires_at` | `timestamptz` | Exactly seven days after creation |
| `accepted_by_user_id` | `uuid` | Nullable FK to `auth.users(id) ON DELETE RESTRICT` |
| `accepted_at` | `timestamptz` | Nullable server time |
| `cancelled_by_user_id` | `uuid` | Nullable FK to `auth.users(id) ON DELETE RESTRICT` |
| `cancelled_at` | `timestamptz` | Nullable server time |

Required checks tie terminal metadata to status:

- `pending` has no accepted or cancelled metadata.
- `accepted` has both accepted fields and no cancelled fields.
- `cancelled` has both cancelled fields and no accepted fields.
- `expires_at = created_at + interval '7 days'`.

The required named constraints are
`space_memberships_lifecycle_check`,
`space_memberships_end_actor_check`,
`space_memberships_lifecycle_time_check`,
`household_invitation_identity_digest_check`,
`household_invitation_token_digest_check`,
`household_invitation_lifecycle_check`, and
`household_invitation_expiry_check`. The private keyring uses
`household_invitation_key_lengths_check` and
`household_invitation_key_retirement_check`.

There is no plaintext email, normalized email, raw token, message content, or
provider response on this table. Invitations are always for the `member` role;
an owner promotes an accepted member through a separate command.

### `public.household_membership_events`

This append-only table is both the audit trail and the idempotency receipt store.
It contains:

- `id uuid` primary key;
- `space_id uuid` with a restrictive space FK;
- `actor_user_id uuid` and nullable `subject_user_id uuid` with restrictive Auth
  FKs;
- `request_id uuid` supplied by the caller;
- `request_fingerprint bytea` constrained to 32 bytes;
- an event kind from `invitation_created`, `invitation_cancelled`,
  `invitation_accepted`, `member_removed`, `member_left`,
  `member_promoted`, and `member_demoted`;
- nullable `invitation_id`, `prior_status`, `next_status`, `prior_role`, and
  `next_role` fields appropriate to the event kind;
- `occurred_at timestamptz NOT NULL DEFAULT now()`.

`UNIQUE (actor_user_id, request_id)` makes a request UUID globally single-use
for that actor across household commands. Event-shape checks require the relevant
invitation or membership fields for each kind. A command replay compares the
stored command kind and fingerprint; an exact replay returns the original safe
outcome without applying state again, while any mismatch is rejected.

The event never contains an email, email digest, raw token, token digest, member
display name, request body, free text, IP address, user agent, or provider data.
An immutable-history trigger rejects `UPDATE`, `DELETE`, and `TRUNCATE`, including
when a test deliberately grants a table privilege and permissive RLS policy.
Name the event-shape check `household_membership_events_shape_check`, the request
uniqueness constraint `household_membership_events_actor_request_key`, and the
immutability triggers
`household_membership_events_reject_row_mutation` and
`household_membership_events_reject_truncate`.

### Cross-row constraint triggers

Add the exact deferred constraint trigger
`space_memberships_preserve_space_owners` after membership insert, update, or
delete. At commit it validates both old and new space IDs: a household has at
least one active owner, while a personal space has exactly one membership row
and that row is active and owner. Add `spaces_preserve_membership_invariants`
after space insert or kind update so a privileged direct space write cannot
commit an ownerless space. Add
`household_invitations_require_household_space` after invitation insert or
space-ID update so even a privileged direct write cannot attach an invitation to
a personal space. Both are `DEFERRABLE INITIALLY DEFERRED`; their private trigger
functions have fixed search paths and no client execution grant.

### Required indexes

The migration must create or retain these indexes and no broad speculative
indexes:

- membership PK: `(space_id, user_id)`;
- `household_invitation_keys_one_active_idx ((true)) WHERE retired_at IS NULL`;
- `space_memberships_active_user_space_idx (user_id, space_id) WHERE status = 'active'` for space visibility;
- `space_memberships_active_owner_idx (space_id, user_id) WHERE status = 'active' AND role = 'owner'` for administration and last-owner checks;
- `space_memberships_ended_by_idx (ended_by_user_id) WHERE ended_by_user_id IS NOT NULL` for its FK;
- invitation unique index on `token_digest`;
- `household_invitations_key_version_idx (key_version)` for its private FK;
- `household_invitations_pending_identity_idx (space_id, invitee_identity_digest, expires_at DESC) WHERE status = 'pending'`;
- `household_invitations_space_created_idx (space_id, created_at DESC, id DESC)` for owner pagination;
- indexes on each non-nullable or partial invitation actor FK:
  `created_by_user_id`, `accepted_by_user_id`, and `cancelled_by_user_id`;
- event unique index on `(actor_user_id, request_id)`;
- `household_membership_events_space_time_idx (space_id, occurred_at DESC, id DESC)`;
- partial event FK indexes on non-null `subject_user_id` and `invitation_id`.

The old unfiltered `(user_id, space_id)` membership index should be replaced by
the active partial index only after `EXPLAIN` and the existing RLS tests confirm
the active lookup uses it. PostgreSQL does not automatically index foreign keys,
so every new FK above must be covered.

## Invitation identity and token handling

### Minimized recipient identity

Invitation creation accepts an email only as transient command input. A private
helper normalizes it as `lower(btrim(email))`, rejects empty, control/whitespace,
missing-or-multiple-`@`, or greater-than-254-byte values, and computes
HMAC-SHA-256 using the active private identity key and an explicit domain prefix.
This is a narrow transport check, not an attempt to reimplement RFC email
validation. Only the key version and 32-byte digest are stored.

Acceptance reads the authenticated caller's email and confirmation timestamp
from `auth.users` inside the security-definer command. The command requires a
non-null, confirmed email, applies the same normalization and versioned HMAC,
and compares the resulting fixed-length digest. A changed email requires a new
invitation. An accepted membership stays tied to the immutable user ID if the
account later changes email.

Plain SHA-256 of an email is not acceptable because email addresses are low
entropy and enumerable. The HMAC key must never be exposed through a function,
view, error, audit event, or application result.

### Reusable invitation secret

Creation derives a 256-bit token using HMAC-SHA-256 over a domain prefix plus the
actor ID, request UUID, space ID, and recipient identity digest. It returns the
base64url token once and stores only `SHA-256(token)`. Deterministic derivation
lets an exact request replay return the same token without storing plaintext.
Different requests still produce unrelated tokens.

The raw token:

- is never stored in PostgreSQL, local storage, application state snapshots,
  analytics, screenshots, logs, errors, or audit metadata;
- is accepted only over TLS and only by the acceptance command;
- is removed from the browser address before any render or network request;
- is never placed in a query string. An invitation URL carries it in the fragment
  and the client clears the fragment with `history.replaceState` before use;
- becomes unusable after acceptance, cancellation, or expiry.

The database and API layers must use parameterized calls and must not enable
parameter/body logging for invitation RPCs. Errors are generic and never echo an
email, identity digest, token, or account-existence fact.

## Protected command surface

All commands below are `SECURITY DEFINER`, use a fixed `search_path` of
`pg_catalog, extensions` only when trusted pgcrypto functions are needed and
`pg_catalog` otherwise, schema-qualify every application object, obtain the actor
from `auth.uid()`, and use transaction-stable `now()`. They revoke execution from
`PUBLIC`, `anon`, and `service_role` and grant only their exact signatures to
`authenticated`.

Every mutation accepts `p_request_id uuid`. Before reading mutable target state,
it acquires a transaction advisory lock derived from `(actor_user_id,
p_request_id)`, checks the event receipt, and rejects request-ID reuse with a
different command or fingerprint.

### `public.create_household_invitation`

```text
create_household_invitation(
  p_space_id uuid,
  p_request_id uuid,
  p_invitee_email text
) -> (invitation_id uuid, invitation_token text, expires_at timestamptz)
```

The command locks the space row, requires an active owner and household kind,
computes the recipient digest, then takes a second advisory lock derived from
`(space_id, recipient_digest)`. It rejects an existing active membership and an
unexpired pending invitation for the same identity. Expired invitations do not
block a new request. It creates a seven-day member invitation and one
`invitation_created` receipt/event atomically.

An exact request replay returns the same invitation ID, expiry, and deterministically
re-derived token. A changed space or email under the same request ID is rejected.

### `public.accept_household_invitation`

```text
accept_household_invitation(
  p_request_id uuid,
  p_invitation_token text
) -> (space_id uuid, membership_status public.membership_status, role public.member_role)
```

The command requires an authenticated caller with a confirmed email, validates a
canonical 43-character base64url token shape, hashes it, and performs a nonlocking
lookup only to discover the space. It then locks in the global order defined
below: space, invitation, membership. It requires `pending`, `expires_at > now()`,
and a recipient digest matching the caller.

It inserts a new active `member` row or reactivates a revoked/left row as
`member`, marks the invitation accepted, and appends the acceptance receipt/event
in one transaction. A same-request replay returns the recorded result without
changing membership. Reusing the token with a different request is rejected,
even by the original recipient. An old accepted token can never restore later
revoked or left access.

Invalid, expired, cancelled, consumed, unknown, and wrong-account tokens all
produce the same safe public error. The distinction is available only to
privileged operational diagnostics that do not log the token.

### `public.cancel_household_invitation`

```text
cancel_household_invitation(
  p_space_id uuid,
  p_request_id uuid,
  p_invitation_id uuid
) -> (invitation_id uuid, status public.household_invitation_status)
```

The command requires an active household owner and a pending invitation in that
space. It may cancel an already expired pending row so the owner can close it.
It cannot cancel an accepted invitation or remove a membership. Exact replay is
idempotent; another request against a terminal invitation is rejected.

### `public.set_household_member_role`

```text
set_household_member_role(
  p_space_id uuid,
  p_request_id uuid,
  p_member_user_id uuid,
  p_role public.member_role
) -> (user_id uuid, status public.membership_status, role public.member_role)
```

The command requires an active owner, household kind, and active target. It
supports only `member <-> owner`. It rejects a no-op and rejects demoting the
last active owner. Promotion is the only route to additional owners; invitations
cannot directly create an owner.

### `public.remove_household_member`

```text
remove_household_member(
  p_space_id uuid,
  p_request_id uuid,
  p_member_user_id uuid
) -> (user_id uuid, status public.membership_status)
```

The command requires an active owner and household kind, rejects self-removal,
requires an active target, and changes it to `revoked`. Removing an owner is
allowed only when another active owner remains. It does not delete history,
cancel accepted invitations, or mutate financial data.

### `public.leave_household_space`

```text
leave_household_space(
  p_space_id uuid,
  p_request_id uuid
) -> (user_id uuid, status public.membership_status)
```

The command acts only on the authenticated caller's active household membership
and changes it to `left`. An owner may leave only when another active owner
remains. It is prohibited for personal spaces.

### Bounded protected reads

Do not broaden direct table visibility to support owner screens. Add:

```text
list_household_members(
  p_space_id uuid,
  p_limit integer default 50,
  p_after_user_id uuid default null
) -> (user_id, role, status, created_at, activated_at, ended_at, is_self)

list_household_invitations(
  p_space_id uuid,
  p_limit integer default 50,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
) -> (invitation_id, effective_status, created_at, expires_at, accepted_at, cancelled_at)
```

Both require an active household owner, enforce `1 <= p_limit <= 100`, use
keyset pagination, and return at most `p_limit` rows. They return no email,
identity digest, token digest, raw token, or free text. The invitation read
computes `expired` for pending rows whose expiry has passed. The membership read
uses opaque user IDs; displaying account emails or profile names would require a
separate, explicitly approved identity-projection design.

## Locking and concurrency

All household mutation commands use one lock order:

1. advisory lock for `(actor_user_id, request_id)`;
2. target `spaces` row `FOR UPDATE`;
3. recipient-identity advisory lock when creating, otherwise invitation rows in
   ascending invitation ID;
4. membership rows in ascending user ID;
5. invitation update, membership update, and append-only event insert.

Acceptance first performs a nonlocking token-digest lookup to learn the space,
then follows the same order and revalidates every invitation field after locking.
No network or email operation occurs while database locks are held.

Locking the space serializes owner-count changes and invitation administration
within a household. A deferred constraint trigger independently verifies at
commit that every household has at least one active owner and every personal
space has exactly one membership row and that row is its active owner. The
separate invitation trigger rejects every personal-space invitation.

Revocation linearizes at its membership update. A financial command already
authorized in a concurrent transaction may finish; revocation is not a rollback
of work that began while access was active. Every command or read whose
authorization check begins after revocation must fail or return no rows.

## RLS, helper, and privilege design

- Replace `private.is_active_member(uuid)` in place so it returns true only for
  `status = 'active'` and `user_id = auth.uid()`. Preserve its signature so every
  existing financial command and RLS policy receives the stronger fact without
  editing those commands.
- Add `private.is_active_owner(uuid)` for protected command internals. It checks
  `status = 'active'`, `role = 'owner'`, and `auth.uid()`; it is not executable by
  client or background roles.
- Keep the spaces policy based only on `is_active_member`.
- Keep `space_memberships` direct SELECT limited to `user_id = auth.uid()`, so a
  user may see their own active, revoked, or left state but not another person's
  row. Owner roster access uses the bounded command.
- Grant the dedicated non-login command owner only SELECT, INSERT, and UPDATE on
  `space_memberships`, with a command-owner-only `USING (true) WITH CHECK (true)`
  RLS policy. It receives no DELETE or TRUNCATE grant. No login role inherits
  from it; callers reach it only through the exact security-definer functions.
- Enable and force RLS on the invitation and event tables. Their dedicated
  non-login command owner receives the sole `USING (true) WITH CHECK (true)`
  owner policy needed by its security-definer functions. Grant no client or
  background SELECT or mutation policy. Protected projections are the only
  application read path.
- Revoke INSERT, UPDATE, DELETE, and TRUNCATE on spaces, memberships,
  invitations, events, and private key tables from `anon`, `authenticated`, and
  `service_role`. Do not rely on RLS alone for mutation control.
- Revoke all function execution before granting the exact public command/read
  signatures to `authenticated`. Private key, digest, owner-check, invariant,
  and immutable-history helpers remain unavailable to application roles.
- Continue to schema-qualify all objects. No function may include `public` or
  another mutable application schema in its search path.

Function owners must be a dedicated non-login migration/command owner rather
than an application login. The test suite must verify the owner and all ACLs from
the PostgreSQL catalog, not infer safety from source text alone.

## Failure behavior and safe errors

Commands fail atomically. No failure may leave an invitation terminal without
its event, a membership changed without its event, or a receipt recorded without
the associated state.

Stable gateway-level classifications are:

- `not_authenticated`: no `auth.uid()` or no confirmed email where required;
- `not_authorized`: caller is not an active household owner or member for the
  requested operation;
- `personal_space_prohibited`: target is not a household;
- `invalid_input`: malformed request ID, email input, token shape, limit, or role;
- `invitation_already_pending`: an unexpired pending invitation exists;
- `invitation_unavailable`: unknown, expired, cancelled, consumed, or recipient
  mismatch on acceptance;
- `membership_already_active`: invited identity already has active access;
- `membership_not_active`: removal, leave, or role target is not active;
- `last_owner`: removal, leave, or demotion would leave no active owner;
- `idempotency_conflict`: an actor reused a request ID with different canonical
  input or command kind.

Public messages must not disclose whether an arbitrary email has an account.
Database error details must not include raw input. The application may show a
more specific "already a member" result to an authorized owner because that
owner can already list the household roster, but acceptance failures remain
fully generic.

## Required rejection cases

The implementation is incomplete until real PostgreSQL tests prove all of these:

1. Anonymous callers cannot execute or read any household command or projection.
2. An unrelated authenticated user cannot discover a space, membership,
   invitation, event, or existence detail by UUID or token guess.
3. An active member can use existing member/financial capabilities but cannot
   list the owner roster or invitations, invite, cancel, remove, or change roles.
4. Revoked and left users lose space and financial visibility and every existing
   protected financial command rejects them with the active-membership error.
5. Every household command rejects a personal space without creating an event.
6. A personal space cannot commit with a second active membership, a non-owner
   active membership, no active owner, or a household invitation.
7. Creation rejects blank/oversized email input, self/already-active recipients,
   duplicate live invitations, and request-ID reuse with changed input.
8. Acceptance rejects malformed, unknown, expired, cancelled, consumed, and
   wrong-confirmed-email tokens with the same public result.
9. Acceptance rejects an unconfirmed account email.
10. Cancelling an accepted invitation cannot revoke its membership; removing a
    member cannot make their old token reusable.
11. Removing oneself through the owner command is rejected; leaving remains the
    only self-removal path.
12. Removing, leaving as, or demoting the last active owner is rejected both by
    command validation and the deferred invariant.
13. A role no-op, inactive target, cross-space target, and invented target user
    are rejected without state or audit changes.
14. Direct table mutations fail for authenticated and service roles. With an
    accidental table grant, RLS still blocks cross-user mutation; with an
    intentionally permissive test policy too, the deferred owner invariant and
    immutable-event trigger still reject invalid state/history tampering.
15. Client/background roles cannot read either private HMAC key or execute a
    helper that reveals it.
16. No function returns or raises an email, email digest, token digest, raw token,
    Auth row, or request fingerprint except the one raw token returned by a
    successful create call.

## Idempotency and concurrency tests

Use independent pooled connections and barriers so calls overlap on the real
engine; sequential `Promise.all` setup without a barrier is not sufficient proof.

- Two identical creation calls with the same actor/request/input both return the
  same invitation ID, token, and expiry; exactly one invitation and one event
  exist.
- Concurrent creation with one request ID but different recipient or space input
  yields one success and one idempotency conflict.
- Concurrent different requests for the same household and identity yield one
  pending invitation and one `invitation_already_pending` rejection.
- Two identical acceptance calls with the same request return one recorded
  outcome, one membership transition, and one acceptance event.
- Two different requests racing on one token produce one acceptance and one
  generic unavailable result.
- Acceptance racing cancellation produces exactly one terminal invitation
  state. If cancellation wins there is no active membership; if acceptance wins,
  cancellation is rejected and the membership/event pair is present.
- Concurrent leave, removal, and demotion attempts affecting the final two owners
  serialize without deadlock and leave at least one active owner.
- Exact replay after a transport-ambiguous success never reapplies a role or
  status transition. Changed-payload replay always conflicts.
- Replaying an accepted token after the member is revoked or leaves never changes
  the inactive state.

## Real-Postgres verification matrix

| Area | Required proof |
| --- | --- |
| Migration | Journal applies from empty database and from a seeded pre-membership database; every existing membership backfills active with preserved role/time |
| Existing behavior | Active personal/household users retain current RLS and all existing financial tests remain green without financial SQL changes |
| Command ACLs | Catalog shows only exact authenticated EXECUTE grants; no app/background table writes; private helpers and keys inaccessible |
| RLS visibility | Owner, member, revoked, left, unrelated, and anonymous sessions each see exactly the rows defined in the capability matrix |
| Recipient privacy | Stored rows and event/log captures contain no plaintext email or raw token; equal normalized emails produce the same private digest without exposing it |
| Token lifecycle | One-time success, exact request replay, expiry boundary using transaction `now()`, cancellation, wrong identity, malformed token, and post-removal replay |
| Membership lifecycle | New acceptance, revoked/left reactivation by a new invite, removal, leave, promotion, demotion, inactive no-ops, and personal prohibition |
| Last owner | Command rejection, deferred-constraint rejection after deliberate bypass, and concurrent owner transitions |
| Atomicity | Forced failure between each logical write rolls back invitation, membership, and event together |
| Concurrency | All races listed above on separate connections; assert outcomes and final rows, not timing alone |
| Bounded reads | Limits outside 1–100 reject; keyset pages do not duplicate or omit stable rows; selective probes use the intended membership/invitation indexes after `VACUUM ANALYZE` |
| Immutable audit | UPDATE, DELETE, and TRUNCATE reject even after deliberate privilege/RLS weakening in test |
| Application contract | Gateway source ratchet finds no direct membership/invitation writes and no token/session logging |

Use the repository's real PostgreSQL/Supabase development engine and explicit
JWT claim sessions. Do not mock RLS, locks, Auth rows, constraints, or command
ACLs. Run the complete existing database suite as a regression gate. A build or
component test is not database-security proof.

## Future application contract

Add a dedicated typed household gateway; do not extend the Loans, Wallets, Auth,
or initial workspace gateway. Its mutation methods map one-to-one to the six
commands above and always accept a caller-generated request UUID. Its reads map
only to the two bounded projections. A source ratchet rejects `.insert()`,
`.update()`, `.delete()`, `.upsert()`, and `.truncate()` in every browser gateway.

The UI contract is:

- Membership controls appear only for a selected RLS-visible household and only
  after the owner projection authorizes them. Hiding a control is not security.
- The invite form keeps the email only in the live form. It clears the value as
  soon as the delivery handoff succeeds and never writes it to browser storage,
  analytics, error reporting, screenshots, or persisted state.
- Every mutation sends once. An ambiguous transport result first refreshes the
  bounded invitation/member projections. A deliberate retry reuses the identical
  request UUID and input.
- Acceptance reads a token from the URL fragment into a local variable, clears
  the URL immediately, then calls the gateway. It never renders or persists the
  token. Account mismatch, expiry, cancellation, and replay share one recovery
  message: sign in with the invited confirmed account or ask an owner for a new
  invitation.
- After accept, cancel, role change, removal, or leave, refresh the visible-space
  set and the household projections before presenting success.
- When the selected space disappears from the fresh visible set, synchronously
  clear all Loans/Wallets/household data, remove that user's stored selection,
  invalidate older in-flight responses, and select the first remaining visible
  space. If none remains, show existing no-space onboarding. Never retain the
  removed household's name, totals, rows, or member list on screen.
- A command rejection caused by lost membership triggers the same recovery even
  before a scheduled/manual refresh.
- Member identifiers are isolated with `<bdi>` and the eventual UI remains fully
  usable in English and Arabic RTL. This design does not approve a profile-name
  or member-email projection.

## Future email delivery is a separate layer

The membership command creates authorization state; it does not send email and
must not call an HTTP endpoint while holding database locks. A later server/Edge
delivery component may receive the transient recipient email, call the creation
command with the user's JWT, build the fragment-based acceptance URL, and pass it
to an email provider with a bounded timeout.

That delivery component must have its own threat model, provider credential,
rate limits, abuse controls, retry/idempotency rules, redaction tests, and delivery
status model. It receives no direct membership-table privilege and cannot accept,
remove, promote, or demote anyone. Provider success is not membership acceptance.

Database commit and email delivery cannot be one transaction. If delivery fails,
the pending invitation remains safely cancellable; the UI does not blindly
create another invitation. Retrying the same creation request re-derives the same
token, while replacement requires cancelling the old invitation and using a new
request UUID. No provider integration, DNS, template, or external send is
authorized by this specification.

## Explicit defaults and deferred decisions

- Invitation lifetime is seven days and is not owner-configurable.
- Invitations grant `member`; ownership requires a later promotion.
- Revoked/left membership history and command events are retained; hard deletion
  and retention schedules are deferred to a privacy/operations policy.
- There is no household ownership transfer shortcut. Promote another member,
  then demote or leave.
- No member email or display-name directory is exposed. A profile/identity
  projection is a separate design.
- No real-time revocation notification is assumed. Fresh RLS reads and command
  failures are authoritative.
- No invitation quotas are fixed here beyond bounded reads. Before email delivery
  ships, product-level per-owner/per-space rate limits and abuse monitoring must
  be specified and tested.

Changing any default requires a decisions-ledger entry in the implementation
commit. This design intentionally leaves `docs/decisions.md` untouched.

## Acceptance boundary

This design is ready for an implementation plan only after owner review. An
implementation plan must keep database migration, gateway/application behavior,
email delivery, and UI work as separate green commits or later milestones. The
database layer is not complete until its real-Postgres rejection, concurrency,
ACL, RLS, migration, and regression tests pass. No later layer may compensate for
a missing database invariant.
