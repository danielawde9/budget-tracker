# Subcategories Application and UI Design

## Status and scope

This specification activates the already merged
`20260910100000_subcategories_foundation.sql` contract in the existing
Categories application and UI. It stays inside the application/UI layer: no
migration, database object, ledger command, authentication, Household, Loans,
Wallet balance, deployment, hosted migration, production-data, or Essentials
bootstrap change is authorized.

Subcategories v1 adds one child-management path to the existing Categories
workspace and exposes the hierarchy in the existing transaction category
picker. It preserves active-only category management, archive-not-delete,
request-idempotent protected commands, exact historical category identity,
independent EN/AR names, and the existing responsive ledger visual language.

## Product behavior

- An active root category renders once in its income or expense register.
- Its active children render immediately beneath it in deterministic category
  order. A child never renders as a second root.
- Only a root exposes `New subcategory`. A child cannot become a parent, be
  reparented, renamed, deleted, or unarchived.
- The subcategory dialog identifies its immutable parent, derives the kind from
  that parent, and accepts the same optional EN/AR names and 120-character
  bounds as root creation.
- Children archive through the existing deliberate archive confirmation. A
  root with active children explains that the children must be archived first
  and does not offer an invalid archive submission.
- Both roots and children remain eligible transaction categories. The picker
  groups children under their root while retaining an explicit Uncategorized
  choice. The submitted category ID is still exactly one root or child ID.
- Journal history continues to render the exact selected category label. It
  does not invent a parent association, duplicate an event, or calculate a
  roll-up.

## Architecture and data flow

`Category` gains `parentCategoryId: string | null`. The bounded active-category
query selects and validates `parent_category_id` alongside the existing
projection. Its `(created_at, id)` keyset remains unchanged; because a parent
must already exist before a child is created, an active child cannot arrive in
an earlier page than its parent.

`CategoriesGateway` adds a single typed `createSubcategory` operation. The
Supabase adapter routes it only to `create_subcategory` with the selected
space, one browser-generated request ID, the immutable parent ID, and trimmed
EN/AR names. `get_category_command_result` remains the sole ambiguous-result
lookup and its typed command-kind union expands to `create_subcategory`.
Direct category writes remain source-ratcheted out.

`useCategories` owns child creation using the same pending, reconciliation,
explicit same-request retry, late-response, and server-refetch rules already
used by category creation and archival. No optimistic child is inserted.

The management page derives a one-level view from the flat, immutable snapshot.
Unknown, cross-kind, or child-as-parent relationships are rejected at the
gateway boundary. The transaction picker uses the same derived relationships
for presentation only; categorized posting payloads and exact minor-unit
movement strings are unchanged.

## Error and recovery behavior

Stable database rejections are mapped to safe EN/AR guidance:

- missing, archived, or invalid parent: refresh the register and choose an
  active root;
- depth violation: choose a root rather than a child;
- root archive with active children: archive the visible children first;
- normalized-name conflict and changed request data: retain the existing safe
  Categories behavior.

Ambiguous child creation performs one bounded command-result lookup. A matching
`create_subcategory` receipt refetches and succeeds; no receipt exposes only an
explicit unchanged retry with the same request ID. Editing either name clears
that retry and causes the next submission to receive a new request ID.

## Accessibility, localization, and responsive behavior

Every database-sourced name remains inside `<bdi>`. Root-child relationships
are represented with semantic nested lists, not indentation alone. Controls
and status/error copy are equivalent in English and Arabic; document RTL and
logical CSS properties mirror the layout without changing stored strings.

Desktop keeps the existing two-register layout. Mobile keeps the income/expense
tabs and full-screen dialog, with 44px minimum interactive targets, visible
focus, Escape/focus restoration, bounded width, and reduced-motion behavior.
The hierarchy uses quiet ledger rules and an inset child rail rather than a new
card system or shared-shell redesign.

## Verification

Development is test-first. Focused unit/component tests must be observed RED
before implementation and GREEN afterward. Final evidence includes all UI
tests, typecheck, production build, the applicable Playwright matrix, inspected
desktop/mobile/EN/AR screenshots, source ratchets for allowed RPCs and direct
writes, `git diff --check`, and a staged-scope audit proving no migration or
unrelated subsystem change.
