# Household Membership and Invitation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully tested EN/AR Household administration and invitation-acceptance UI using only the merged protected commands and read models.

**Architecture:** A focused Household feature owns its typed Supabase adapter, safe errors, request state, owner/member screens, and dialogs. The existing shell exposes the feature only for a selected household, while a pre-render fragment handoff supports acceptance without persisting the raw token. Workspace refresh remains the authority for newly gained or lost space access.

**Tech Stack:** React 19, strict TypeScript 7, Supabase JS 2, Vitest, Testing Library, Playwright, Vite, CSS logical properties.

---

## File map

- Create `src/features/household/types.ts`: immutable Household domain and gateway contract.
- Create `src/features/household/errors.ts`: safe error classification and localized messages.
- Create `src/features/household/supabase-household-gateway.ts`: strict row adapter and allowlisted reads/RPCs.
- Create `src/features/household/use-household.tsx`: space-scoped loading, pagination, and mutation state.
- Create `src/features/household/household-dialogs.tsx`: accessible invite, acceptance, and confirmation dialogs.
- Create `src/features/household/household-page.tsx`: owner/member presentation.
- Create `src/features/household/invitation-fragment.ts`: synchronous one-use fragment extraction.
- Create matching unit/component tests and `src/test/in-memory-household-gateway.ts`.
- Modify `src/features/shell/application-shell.tsx`: conditional Household navigation.
- Modify `src/app.tsx`: gateway construction, destination rendering, acceptance handoff, and workspace refresh.
- Modify `src/main.tsx`: clear the invitation fragment before client/render initialization.
- Modify `src/features/workspace/use-workspace.ts` and its test: allow a freshly
  visible accepted household to be preferred during the authoritative refresh.
- Modify `src/styles.css`: responsive, RTL-safe Household presentation.
- Create `e2e/fixtures/household.ts` and `e2e/household.visual.spec.ts`: local deterministic visual states.

### Task 1: Freeze the typed Household gateway boundary

**Files:**
- Create: `src/features/household/types.ts`
- Create: `src/features/household/errors.ts`
- Create: `src/features/household/errors.test.ts`
- Create: `src/features/household/supabase-household-gateway.ts`
- Create: `src/features/household/supabase-household-gateway.test.ts`

- [ ] **Step 1: Write failing adapter and error tests**

Define recording clients in the test and assert exact calls such as:

```ts
expect(rpcCalls).toContainEqual({
  name: 'list_household_members',
  args: { p_space_id: SPACE_ID, p_limit: 50, p_after_user_id: null },
});
expect(rpcCalls).toContainEqual({
  name: 'create_household_invitation',
  args: { p_space_id: SPACE_ID, p_request_id: REQUEST_ID, p_invitee_email: 'member@example.com' },
});
expect(created).toEqual({
  invitationId: INVITATION_ID,
  expiresAt: '2026-09-17T10:00:00.000Z',
});
expect(JSON.stringify(created)).not.toContain('invitation-token');
```

Cover all six mutation RPCs, both projection RPCs, the RLS-visible
`space_memberships` self read, malformed UUID/timestamp/enum/boolean rows,
zero/multirow mutation responses, the `1..100` page bound, exact member and
invitation cursor forwarding, and generic error classification.

- [ ] **Step 2: Run the focused tests and observe RED**

Run:

```bash
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/household/errors.test.ts \
  src/features/household/supabase-household-gateway.test.ts
```

Expected: FAIL because the Household modules do not exist.

- [ ] **Step 3: Add the immutable contract**

Use these domain shapes:

```ts
export type MemberRole = 'owner' | 'member';
export type MembershipStatus = 'active' | 'revoked' | 'left';
export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface HouseholdMembership {
  readonly userId: string;
  readonly role: MemberRole;
  readonly status: MembershipStatus;
  readonly createdAt: string;
  readonly activatedAt: string;
  readonly endedAt: string | null;
  readonly isSelf: boolean;
}

export interface HouseholdInvitation {
  readonly invitationId: string;
  readonly effectiveStatus: InvitationStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly cancelledAt: string | null;
}

export interface HouseholdGateway {
  getSelfMembership(spaceId: string, userId: string): Promise<HouseholdMembership | null>;
  listMembers(spaceId: string, afterUserId?: string, limit?: number): Promise<readonly HouseholdMembership[]>;
  listInvitations(spaceId: string, cursor?: { readonly createdAt: string; readonly invitationId: string }, limit?: number): Promise<readonly HouseholdInvitation[]>;
  createInvitation(input: { readonly spaceId: string; readonly requestId: string; readonly email: string }): Promise<{ readonly invitationId: string; readonly expiresAt: string }>;
  acceptInvitation(input: { readonly requestId: string; readonly token: string }): Promise<{ readonly spaceId: string; readonly status: 'active'; readonly role: 'member' }>;
  cancelInvitation(input: { readonly spaceId: string; readonly requestId: string; readonly invitationId: string }): Promise<void>;
  setMemberRole(input: { readonly spaceId: string; readonly requestId: string; readonly userId: string; readonly role: MemberRole }): Promise<void>;
  removeMember(input: { readonly spaceId: string; readonly requestId: string; readonly userId: string }): Promise<void>;
  leaveHousehold(input: { readonly spaceId: string; readonly requestId: string }): Promise<void>;
}
```

- [ ] **Step 4: Implement strict normalization and allowlisted calls**

The creation adapter must destructure and omit the token at the boundary:

```ts
const row = requireSingleRow(await client.rpc('create_household_invitation', {
  p_space_id: input.spaceId,
  p_request_id: input.requestId,
  p_invitee_email: input.email,
}));
const invitationId = requireUuid(row.invitation_id, 'invitation_id');
const expiresAt = requireTimestamp(row.expires_at, 'expires_at');
return { invitationId, expiresAt };
```

Implement every gateway method with explicit columns, exact RPC argument names,
bounded limits, and fail-closed row parsing. Never return or log
`row.invitation_token`. Map raw failures to internal safe kinds:
`access-lost`, `invitation-unavailable`, `owner-required`, `last-owner`,
`invalid-input`, or `request-failed`.

- [ ] **Step 5: Run focused and ratchet tests GREEN**

Run the Task 1 Vitest command, then:

```bash
rg -n "\.(insert|update|delete|upsert)\(" src/features/household
rg -n "invitation_token|console\.|localStorage|sessionStorage" src/features/household
```

Expected: tests PASS; the direct-write scan returns no matches; the token scan
matches only the single adapter destructuring/validation site and tests.

- [ ] **Step 6: Commit the gateway boundary**

```bash
git add src/features/household
git commit -m "feat(household): add protected UI gateway"
```

### Task 2: Build space-scoped Household state with idempotent retries

**Files:**
- Create: `src/test/in-memory-household-gateway.ts`
- Create: `src/features/household/use-household.tsx`
- Create: `src/features/household/use-household.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Use `renderHook` and an in-memory gateway to prove:

```ts
expect(result.current.status).toBe('owner-ready');
expect(result.current.members).toEqual(expect.arrayContaining([
  expect.objectContaining({ userId: OWNER_ID, role: 'owner', isSelf: true }),
]));
expect(gateway.calls).toContainEqual({ name: 'listMembers', spaceId: SPACE_ID, limit: 50 });
```

Add separate tests for member state not calling owner projections, stale-state
clearing on user/space change, 50-row member and invitation pagination, failed
next-page preservation/retry, one in-flight mutation, request-ID reuse after a
failed retry, new request IDs for new intent, successful refetch, and
`onSpaceUnavailable` after access loss or leave.

- [ ] **Step 2: Run the hook test and observe RED**

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/household/use-household.test.tsx
```

Expected: FAIL because `useHousehold` and the in-memory gateway do not exist.

- [ ] **Step 3: Implement the state machine**

Expose one discriminated result:

```ts
type HouseholdState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: string; retry(): Promise<void> }
  | { readonly status: 'member-ready'; readonly self: HouseholdMembership; leave(): Promise<void> }
  | {
      readonly status: 'owner-ready';
      readonly self: HouseholdMembership;
      readonly members: readonly HouseholdMembership[];
      readonly invitations: readonly HouseholdInvitation[];
      readonly membersHasMore: boolean;
      readonly invitationsHasMore: boolean;
      loadMoreMembers(): Promise<void>;
      loadMoreInvitations(): Promise<void>;
      createInvitation(email: string): Promise<void>;
      cancelInvitation(invitationId: string): Promise<void>;
      setMemberRole(userId: string, role: MemberRole): Promise<void>;
      removeMember(userId: string): Promise<void>;
      leave(): Promise<void>;
    };
```

Keep state keyed by `{userId, spaceId}` and clear it synchronously through the
rendered discriminant when either key changes. Keep request IDs in a bounded map
for only the current pending/retryable user intent; delete them after confirmed
success or when the dialog/action is abandoned.

- [ ] **Step 4: Run hook tests GREEN and commit**

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/household/use-household.test.tsx
git add src/features/household/use-household.tsx \
  src/features/household/use-household.test.tsx \
  src/test/in-memory-household-gateway.ts
git commit -m "feat(household): manage protected household state"
```

Expected: all hook tests PASS before commit.

### Task 3: Render owner and member management flows

**Files:**
- Create: `src/features/household/household-dialogs.tsx`
- Create: `src/features/household/household-page.tsx`
- Create: `src/features/household/household-page.test.tsx`

- [ ] **Step 1: Write failing page tests**

Render with the in-memory gateway and assert:

```ts
expect(await screen.findByRole('heading', { name: 'Household access' })).toBeInTheDocument();
expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
expect(screen.getAllByText(OTHER_MEMBER_ID).every((node) => node.closest('bdi'))).toBe(true);
expect(screen.queryByText(/invitation-token/i)).not.toBeInTheDocument();
```

Cover owner and member variants, invitation creation with honest no-delivery
success copy, cancellation, promote/demote, remove, leave, last-owner rejection,
initial/empty/error/recovery states, pagination/retry, disabled pending actions,
confirmation checkboxes, focus containment/Escape/restoration, EN/AR copy, and
opaque identity isolation.

- [ ] **Step 2: Run the page test and observe RED**

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/household/household-page.test.tsx
```

Expected: FAIL because the page and dialogs do not exist.

- [ ] **Step 3: Implement dialogs with the existing focus contract**

Reuse the proven dialog behavior from `src/features/wallets/dialog-shell.tsx`
through a Household-local focused component. Each confirmation renders:

```tsx
<div className="overlay" role="presentation">
  <section ref={panel} className="dialog household-dialog" role="dialog"
    aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header className="dialog-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="icon-button" aria-label={closeLabel}>×</button>
    </header>
    {children}
  </section>
</div>
```

Include bounded tabbable-element focus wrapping, initial panel focus, Escape
handling while not pending, and opener restoration.

- [ ] **Step 4: Implement the registers and action semantics**

Render database strings only within `<bdi>`, render role/status text separately,
and expose actions only when legal from known state. The creation success must be
exactly honest in meaning: `Invitation record created. Delivery is not configured.`
The Arabic equivalent must state the same limitation. Do not render recipient
email after success or any token value at any time.

- [ ] **Step 5: Run page and prior Household tests GREEN and commit**

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/household
git add src/features/household/household-dialogs.tsx \
  src/features/household/household-page.tsx \
  src/features/household/household-page.test.tsx
git commit -m "feat(household): add accessible membership workspace"
```

Expected: all Household tests PASS.

### Task 4: Integrate Household into the authenticated shell

**Files:**
- Modify: `src/features/shell/application-shell.tsx`
- Modify: `src/features/shell/application-shell.test.tsx`
- Modify: `src/app.tsx`
- Modify: `src/app.test.tsx`

- [ ] **Step 1: Write failing shell and app integration tests**

Add assertions that Household navigation exists only for `kind === 'household'`,
uses `aria-current`, localizes to `المنزل`, and resets to Loans when a personal
space is selected. In `app.test.tsx`, inject `householdGateway` and assert:

```ts
await user.click(screen.getByRole('button', { name: 'Household' }));
expect(await screen.findByRole('heading', { name: 'Household access' })).toBeInTheDocument();
await user.selectOptions(screen.getByRole('combobox', { name: 'Current space' }), personalSpace.id);
expect(await screen.findByRole('heading', { name: 'Loans' })).toBeInTheDocument();
expect(screen.queryByRole('button', { name: 'Household' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run tests and observe RED**

```bash
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/shell/application-shell.test.tsx src/app.test.tsx
```

Expected: FAIL because `household` is not a destination or injected gateway.

- [ ] **Step 3: Add the conditional destination**

Extend the destination exactly:

```ts
export type ApplicationDestination = 'loans' | 'wallets' | 'categories' | 'household';
```

Render the navigation button only for a selected household. In
`AuthenticatedWorkspace`, pass `userId`, `spaceId`, `locale`, and the typed
gateway to `HouseholdPage`. Use an effect to reset an active Household
destination to Loans when `selectedSpace.kind !== 'household'`.

- [ ] **Step 4: Run shell/app tests GREEN and commit**

```bash
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/shell/application-shell.test.tsx src/app.test.tsx
git add src/features/shell/application-shell.tsx \
  src/features/shell/application-shell.test.tsx src/app.tsx src/app.test.tsx
git commit -m "feat(household): integrate household navigation"
```

### Task 5: Accept fragment invitations before onboarding

**Files:**
- Create: `src/features/household/invitation-fragment.ts`
- Create: `src/features/household/invitation-fragment.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/app.tsx`
- Modify: `src/app.test.tsx`
- Modify: `src/features/household/household-dialogs.tsx`
- Modify: `src/features/workspace/use-workspace.ts`
- Modify: `src/features/workspace/use-workspace.test.tsx`

- [ ] **Step 1: Write failing fragment and application tests**

Prove the exact accepted form and immediate cleanup:

```ts
window.history.replaceState(null, '', '/#household-invitation=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
expect(takeHouseholdInvitation(window.location, window.history)).toBe(
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
);
expect(window.location.hash).toBe('');
```

Reject malformed/duplicate/unrelated fragments and still clear any
`household-invitation` fragment. App tests must prove acceptance appears for an
authenticated no-space user before onboarding, generic unavailable failure
copy, successful workspace refresh/selection, AR parity, token absence from DOM,
and pending focus behavior. Add a workspace-hook test proving that
`refresh(acceptedSpaceId)` chooses that newly visible space even when an older
personal space remains first in the projection.

- [ ] **Step 2: Run fragment/app tests and observe RED**

```bash
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/household/invitation-fragment.test.ts src/app.test.tsx
```

Expected: FAIL because fragment extraction and acceptance precedence are absent.

- [ ] **Step 3: Implement synchronous one-use extraction**

Use no decoding or storage beyond a local return value:

```ts
const PREFIX = '#household-invitation=';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function takeHouseholdInvitation(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): string | null {
  if (!location.hash.startsWith(PREFIX)) return null;
  const candidate = location.hash.slice(PREFIX.length);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return TOKEN.test(candidate) ? candidate : null;
}
```

Call it in `main.tsx` before `createRoot` and pass the value to `<App
initialHouseholdInvitationToken={token} />`.

- [ ] **Step 4: Add acceptance precedence and refresh**

Hold the token only in the top-level authenticated page lifetime. Pass it to the
acceptance dialog, discard it immediately after one successful or terminal
attempt, and retain it with the same request ID after a retryable transport
failure. Call the protected acceptance RPC, then await
`workspace.refresh(result.spaceId)`. Extend the workspace hook's internal load
selection order to `preferred visible ID`, current ID, stored ID, then first
visible ID. When workspace status is `empty`, acceptance renders before
`OnboardingDialog`.

- [ ] **Step 5: Run tests GREEN, scan, and commit**

```bash
pnpm exec vitest run --config vitest.ui.config.ts \
  src/features/household/invitation-fragment.test.ts src/app.test.tsx
rg -n "localStorage|sessionStorage|console\.|invitation_token" \
  src/main.tsx src/app.tsx src/features/household
git add src/main.tsx src/app.tsx src/app.test.tsx src/features/household
git commit -m "feat(household): accept secure invitation fragments"
```

Expected: tests PASS; scan finds no persistence/logging and no production token
rendering.

### Task 6: Add responsive styling and deterministic visual coverage

**Files:**
- Modify: `src/styles.css`
- Create: `e2e/fixtures/household.ts`
- Create: `e2e/household.visual.spec.ts`

- [ ] **Step 1: Write failing visual scenarios**

Add deterministic local fixture responses for owner roster/invitations, member
leave, empty owner state, error/retry, invite dialog, destructive confirmation,
and acceptance. Create EN/AR cases at both configured desktop and mobile
projects. Assert no horizontal overflow and capture only Playwright's ignored
test output:

```ts
await expect(page.getByRole('heading', { name: 'Household access' })).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
await page.screenshot({ path: testInfo.outputPath('household-owner-en.png'), fullPage: true });
```

- [ ] **Step 2: Run the visual spec and observe RED**

```bash
pnpm test:e2e -- e2e/household.visual.spec.ts
```

Expected: FAIL on missing fixture wiring or Household styles.

- [ ] **Step 3: Add disciplined Household styles**

Add `.household-workspace`, `.household-columns`, `.household-register`,
`.household-row`, `.household-status`, and `.household-actions` rules using the
existing CSS variables and logical properties. Desktop uses
`grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr)`. At 820px stack to one
column, wrap actions, and inherit the existing full-screen `.dialog` behavior.
Add explicit `:focus-visible` treatment and never letter-space Arabic.

- [ ] **Step 4: Run visual coverage and inspect every screenshot**

```bash
pnpm test:e2e -- e2e/household.visual.spec.ts
find test-results -name 'household-*.png' -type f -print
```

Inspect owner/member/empty/error/dialog/acceptance screenshots for desktop and
mobile in EN and AR. Record Pass/Fail per state in the task handoff; fix any
clipping, focus, hierarchy, or RTL issue through a new failing assertion before
changing production CSS.

- [ ] **Step 5: Commit the visual layer**

```bash
git add src/styles.css e2e/fixtures/household.ts e2e/household.visual.spec.ts
git commit -m "test(household): verify responsive bilingual flows"
```

### Task 7: Run final safety and integration gates

**Files:**
- Modify only if a failing gate reveals an in-scope Household defect.

- [ ] **Step 1: Load the authoritative ignored test environment**

Use the repository's existing `.env.test` without printing its contents:

```bash
set -a
source /Users/daniel/Desktop/Daniel/budget-tracking/.env.test
set +a
```

- [ ] **Step 2: Run focused and full verification**

```bash
pnpm exec vitest run --config vitest.ui.config.ts src/features/household
pnpm typecheck
pnpm test:ui
pnpm build
pnpm test:e2e -- e2e/household.visual.spec.ts
pnpm check
```

Expected: every command exits 0 with no warnings. `pnpm check` includes the real
PostgreSQL suite and must use the sourced test environment.

- [ ] **Step 3: Run boundary and diff ratchets**

```bash
test -z "$(rg -n "\.(insert|update|delete|upsert)\(" src/features/household || true)"
test -z "$(rg -n "console\.|localStorage|sessionStorage" src/features/household src/app.tsx src/main.tsx || true)"
git diff 4018d81 -- supabase/migrations tests/db
git diff --check 4018d81..HEAD
git status --short
```

Expected: no direct writes or secret persistence/logging; no migration or DB-test
diff; clean whitespace; only intentional committed files.

- [ ] **Step 4: Invoke verification-before-completion and report exact evidence**

Read and follow `superpowers:verification-before-completion`. Report exact test
counts, commands, screenshot matrix results, branch/commit list, unchanged
protected areas, and remaining gates: merge, push, hosted migration/application,
live authenticated UAT, provider delivery, deployment, and external sending.
