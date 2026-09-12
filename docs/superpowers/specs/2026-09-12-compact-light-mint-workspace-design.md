# Compact light-and-mint workspace refinement

**Date:** 2026-09-12  
**Scope:** authenticated shell and shared presentation tokens only

## Intent

Replace the current dark, over-spaced workspace treatment with the approved
light neutral rail and mint active state shown in visual direction 2. The
application should feel like a compact working tool rather than a marketing
landing page: less empty vertical space, smaller title scale, and clear but
restrained color.

## Visual contract

- The desktop rail is light neutral with a subtle divider; its active item is
  mint with dark green text. Inactive navigation is dark green on the neutral
  rail. No dark full-height rail remains.
- Logo, space selector, navigation, language action, and account action use a
  tighter 8px-based rhythm. Navigation remains icon-plus-label and retains
  accessible names.
- Main workspace titles, page controls, and empty states use compact spacing
  and bounded heading sizes. Data accent surfaces may use mint, peach, and
  soft blue, but primary actions retain strong contrast.
- Responsive breakpoints continue to collapse the rail without reducing touch
  targets below their existing accessible size. RTL uses logical properties,
  preserving the same hierarchy and spacing.

## Boundaries

No route, auth, command, gateway, financial calculation, database, archive,
or dialog behavior changes. Existing user-visible text and focus behavior stay
stable. The refinement is CSS and presentational shell markup only.

## Verification

Add a shell regression that identifies the light rail and mint active state;
then run focused shell tests, the full unit suite, typecheck, build, and the
targeted EN/AR desktop/mobile visual tests. Inspect fresh browser screenshots
before merging into `main`.
