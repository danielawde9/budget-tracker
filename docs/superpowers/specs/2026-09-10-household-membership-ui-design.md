# Household Membership and Invitation UI Design

## Status and scope

This document specifies the application-only Household membership and invitation
milestone. It starts from local `main` commit `4018d81` and consumes only the
already-merged Household protected commands, bounded projections, and the
existing RLS-protected self-membership read.

The milestone does not change database migrations, grants, RLS, Auth identity,
financial tables or commands, ledger behavior, Categories, Subcategories,
Loans, or Wallets. It does not configure email delivery, send invitations,
apply hosted migrations, deploy, push, or touch real user data.

## Chosen experience

Add a `Household` destination to the authenticated application shell. The
destination is available only while the selected space is a household. A
personal space never exposes household administration controls. If the user
switches from a household to a personal space while viewing Household, the
shell returns to Loans rather than leaving an invalid destination mounted.

Household administration uses the application's existing quiet register-like
visual language: pine and paper colors, strong typographic hierarchy, semantic
rules instead of decorative cards, and logical CSS properties for both text
directions. The memorable element is the roster register: each membership is a
clear account-access record with role, lifecycle status, and restrained actions.

### Visual tokens and layout

- Ink `#17231d`, pine `#1f5a43`, paper `#f4f6f1`, white `#fbfcf8`, rule
  `#c7cfc7`, danger `#8a2f22`.
- Reuse the app's existing type family and scale; do not introduce a new font or
  external asset for this operational surface.
- Desktop uses a two-column workspace: roster as the primary register and
  invitations as the secondary register. Mobile stacks both registers and
  makes dialogs full-screen.
- Content aligns to the logical start edge. Database-sourced identifiers and
  space names are isolated with `<bdi>`.
- Status and role are always expressed in text, not color alone.

```text
+---------------------------------------------------------------+
| Household name                                  Invite member |
| Access is managed through protected household commands.       |
+-------------------------------------+-------------------------+
| Members                             | Invitations             |
| self / owner / active     actions   | pending    date action  |
| opaque id / member / active actions | expired    date         |
| ...                                 | ...                     |
+-------------------------------------+-------------------------+
| Leave household                                               |
+---------------------------------------------------------------+
```

## Application boundaries

Create a focused `src/features/household/` module with these responsibilities:

- `types.ts` defines immutable gateway inputs and outputs, membership roles and
  statuses, invitation effective statuses, and the Household gateway contract.
- `supabase-household-gateway.ts` adapts Supabase result shapes and calls only
  approved reads and RPCs.
- `errors.ts` maps database failures to safe, localized application error keys
  without echoing recipient email, invitation token, or account-existence data.
- `use-household.tsx` owns state scoped to one authenticated user and selected
  household space. It clears stale data on either boundary change, bounds each
  projection page to 50 rows, and refreshes after successful commands.
- `household-page.tsx` renders owner and member states.
- Focused dialog components render invitation entry, role/removal confirmation,
  leaving, and invitation acceptance.

The module must contain no `.insert()`, `.update()`, `.delete()`, or `.upsert()`
call. Mutation is allowlisted to these RPCs:

- `create_household_invitation`
- `accept_household_invitation`
- `cancel_household_invitation`
- `set_household_member_role`
- `remove_household_member`
- `leave_household_space`

Owner projections are allowlisted to `list_household_members` and
`list_household_invitations`. The current user's role and status come from the
existing direct self-membership select permitted by RLS; the browser never
reads another user's membership row directly.

Every mutation receives a fresh `crypto.randomUUID()` request ID. Retries of a
pending action retain that action's request ID so the database's idempotency
contract remains effective. A new user intent creates a new request ID.

## Roles and visible capabilities

### Active owner

An owner sees the complete bounded roster and invitation projection. They may:

- enter an invitee email and create a seven-day member invitation record;
- cancel a pending or expired invitation record through the approved command;
- promote an active member to owner;
- demote an owner when the database permits it;
- remove another active member or owner when the database permits it;
- leave the household when another active owner remains.

Destructive and authority-changing actions require a named confirmation dialog.
The UI explains that database owner invariants may reject a last-owner action
and leaves the roster unchanged when rejection occurs.

### Active member

A member does not call owner projections and never sees their data. They see a
concise access panel for the selected household and may leave it through the
approved command after confirmation.

### Inactive or lost access

If the self-membership read is inactive, missing, or becomes unauthorized, the
Household projection is cleared immediately. The workspace list is refreshed;
the existing selected-space validation chooses another visible space or the
safe empty workspace state. No prior roster or invitation content remains on
screen.

## Invitation creation without delivery

The form accepts one email address. PostgreSQL remains authoritative for
normalization and validation; the browser performs only basic required/type
checks for usability. The recipient address is submitted only as the RPC
parameter and is never added to the invitation list or retained after success.

The creation RPC returns a raw token because it is the approved database
contract. This milestone immediately discards that token at the gateway
boundary. It must not be rendered, copied, logged, placed in component state,
stored in browser storage, included in analytics, or captured in screenshots.
The success message says that the invitation record was created and delivery is
not configured. This is deliberately honest: the milestone proves safe record
management but does not pretend an invitation was sent.

Because the bounded invitation projection contains no recipient identity, the
list shows only status and lifecycle dates. It does not invent an email, name,
or delivery state.

## Invitation acceptance

The application supports a future provider's fragment link without adding that
provider. Before React renders or the data client makes a request, `main.tsx`
extracts a canonical 43-character base64url token from
`#household-invitation=<token>` and immediately removes the entire fragment with
`history.replaceState`.

The raw token exists only in a short-lived in-memory handoff to the acceptance
dialog and the `accept_household_invitation` RPC call. It is never echoed or
persisted. Malformed, expired, cancelled, consumed, unknown, and wrong-account
tokens all show the same generic unavailable message.

An authenticated user with no current visible space sees invitation acceptance
before first-space onboarding. After successful acceptance, the workspace is
refreshed and the newly visible household is selected. A signed-out user may
authenticate normally while the in-memory token remains in the current page;
refreshing the page after fragment removal intentionally loses it.

## Loading, pagination, and failure behavior

- Initial self-membership and owner projections show a single accessible status
  region and no stale content.
- Empty roster or invitation projection uses explicit empty copy.
- Owner projections request 50 rows at a time. `Load more` uses the exact last
  item cursor and disappears when fewer than 50 rows return.
- Only one projection request or mutation of a given kind may be pending. Its
  triggering control is disabled and exposes pending text.
- Read failures keep the page recoverable with a `Try again` control.
- Mutation failures leave confirmed server state unchanged and preserve enough
  non-secret input to retry. Authentication/authorization loss triggers the
  workspace refresh path.
- Error copy is generic and localized. It never includes raw Supabase messages
  that could reveal an email, token, or authorization distinction.

## Accessibility and bidirectionality

- All dialogs have an accessible name, modal semantics, initial focus, Escape
  dismissal when safe, focus containment, and focus restoration.
- Confirmation dialogs name the action and affected opaque identifier. The
  primary destructive action uses text in addition to danger color.
- Status updates use polite live regions; failures use alerts.
- Every interactive control has a 44px minimum target and visible focus style.
- EN and AR copy is complete. CSS uses logical properties, ordering remains
  meaningful in RTL, and Arabic is never letter-spaced.
- On screens at or below 820px, registers stack, action groups wrap without
  horizontal overflow, and dialogs occupy the viewport.
- Reduced-motion preference disables nonessential motion.

## Test-first implementation and verification

Implementation proceeds in green commits, each beginning with a focused failing
test that is run and observed before production code is added.

Automated coverage must prove:

- gateway row normalization, exact RPC names/parameters, bounded cursors,
  request-ID reuse, token discard, safe errors, and direct-write ratchets;
- owner, member, personal-space, lost-access, loading, empty, failure, retry,
  pagination, and every confirmation flow;
- creation success never renders the token or claims external delivery;
- fragment extraction and removal occurs before application initialization;
- successful acceptance refreshes and selects the new household, including the
  no-space state;
- locale parity, RTL direction, keyboard operation, focus restoration, and
  accessible status/error announcements;
- responsive desktop and mobile visual states for both EN and AR.

Final verification includes the focused red/green record, the full UI suite,
typecheck, production build, relevant offline Playwright scenarios, direct-write
and secret-render scans, `git diff --check`, and repository-wide `pnpm check`
with the authoritative test database environment. Visual screenshots go only
to ignored per-run output unless curated artifact updates are explicitly
authorized.

## Deferred work and integration gates

Email-provider delivery, member profile/email projection, owner invitations,
new membership roles, routing infrastructure, hosted migration application,
live authenticated UAT, deployment, and external invitation sending remain out
of scope.

Completion of this branch proves the local application integration only. Merge,
push, hosted operation, real-email delivery, and installed/live-product proof
remain separate owner-gated integration steps.
