# Financial workspace redesign

**Status:** Design approved; implementation not started.

## Outcome

Replace the current dense ledger-style presentation with a calm, transaction-first
personal-finance workspace. The product must feel deliberate in its typography,
spacing, navigation, and hierarchy without widening the financial-product scope.

The selected visual direction is the third concept from the 2026-09-11 design
exploration: a practical financial workspace with a compact navigation rail,
a transaction-centered main surface, and contextual wallet balances. Its generated
flags, search, notifications, and unimplemented actions are reference-only and
must not be copied into the product.

## Scope

### Included

- Add a route-backed Home destination as the authenticated entry point.
- Redesign the application shell, Home, Wallets, Loans, Categories, Household,
  authentication, empty states, loading/error states, and dialogs as one system.
- Use Wallets as the transaction-first daily workspace; Home is a concise
  orientation surface, not a second reporting product.
- Replace text-symbol navigation glyphs with a consistent installed icon set.
- Establish shared tokens and reusable layout primitives for spacing, type,
  colors, button hierarchy, form controls, lists, notices, and dialogs.
- Verify desktop, mobile, English, Arabic RTL, keyboard focus, and recovery
  states with the existing app flows.

### Excluded

- Financial command, gateway, RLS, schema, migration, balance, archive, or
  idempotency changes.
- New reports, budgeting, search, notifications, bank sync, analytics, goals,
  currencies, or account-management features.
- Changes to the active Wallet archive workstream other than visually consuming
  the already-approved UI behavior when it is integrated.

## Information architecture

Authenticated navigation is ordered by everyday need: Home, Wallets, Loans,
Categories, then Household only for household spaces. The disabled Reports item
is removed from primary navigation until it is a real route. Space switching,
locale switching, and account actions stay available but are visually quieter
than navigation and the page's primary task.

Home answers only: where am I, what are my active wallet balances, and what was
the latest activity? It links into Wallets for the full journal. It must not
duplicate a category-management, loan-management, or reporting view.

Wallets remains the daily work surface. The page leads with its title and a
single **Add transaction** action. Active balances are compact, readable context;
the journal is the visual center. Rows use clear date, event, wallet, category
where applicable, and signed amount hierarchy. Corrections are visible but never
look equally prominent as the primary action.

## Visual system

Use an 8px spacing scale and enforce it through shared custom properties. Page
gutters, section gaps, list row padding, form gaps, and dialog padding must use
that scale rather than ad-hoc values. The desktop shell has a compact rail,
generous but bounded main content width, and no full-page dark backdrop.

Typography uses a readable sans-serif product face with a modest display scale:
page titles are strong but never dominate the viewport. Body copy is 14–16px.
Money is tabular and direction-isolated. Separation comes first from whitespace,
grouping, and restrained row dividers; cards, borders, pills, and shadows are
exceptions rather than the default.

Colors are an off-white base, deep navy/ink text, blue-grey secondary text, and
one teal primary-action accent. Destructive states retain a distinct accessible
red. Status colors are semantic, not decorative. The account/backup boundary is
preserved as truthful operator information but moves out of the everyday visual
path and does not make the product appear unsafe.

## Component boundaries

- `ApplicationShell`: rail, account/space controls, responsive navigation, and
  destination selection only.
- `HomePage`: derived read-only composition from existing workspace/wallet data;
  no direct financial writes.
- Shared presentation components: `PageHeader`, `PrimaryAction`, `SectionHeader`,
  `BalanceList`, `JournalList`, `EmptyState`, `InlineNotice`, and `DialogShell`.
- Feature pages retain their existing typed gateways and hooks. They consume the
  shared presentation components but own feature copy and commands.

No component may introduce a direct Supabase table write, manufacture a balance,
or duplicate command/recovery logic already owned by the gateways/hooks.

## Responsive, RTL, and accessible behavior

On mobile, navigation becomes a deliberate compact top/navigation control rather
than a horizontally overflowing desktop rail. The primary action remains visible,
rows collapse to a readable two-level layout, and context moves below the journal
when needed. Dialogs remain full-screen on narrow viewports with clear heading,
close action, and persistent action area.

All layout uses logical CSS properties. Arabic receives the same hierarchy and
space—not mirrored visual hacks. DB-provided text remains in `bdi`; money remains
direction-isolated. Controls have visible focus states, 44px minimum targets,
semantic labels, error recovery text, and status announcements. Screenshot review
does not claim full accessibility conformance; keyboard and assistive-technology
checks remain explicit verification work.

## Implementation order and proof

1. Add tokens, icon dependency, shell primitives, and regression tests without
   changing commands or feature hooks.
2. Add Home using existing read models and make it the authenticated default.
3. Rework Wallets and dialogs around the shared system.
4. Apply the same system to Loans, Categories/archive, Household, onboarding,
   authentication, and all states.
5. Run focused UI tests, typecheck, production build, E2E, and manual visual
   evidence at desktop/mobile and EN/AR RTL. Record Pass/Fail/Blocked results.

The Home read model must be bounded: current active wallets plus the already
bounded first journal page only. It must not add unbounded client aggregation or
new network calls that bypass the approved gateways.
