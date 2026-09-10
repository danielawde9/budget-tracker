# Subcategories Database Foundation Design

## Status and scope

This specification defines the database-only Subcategories v1 extension to the
verified Categories v1 contract. It does not authorize or implement UI,
monthly budgets, reporting, deployment, or production migration application.

The extension preserves the existing immutable financial journal, optional
one-category-per-event association, reversal inheritance, category naming,
archive-not-delete lifecycle, active-member authorization, and uncategorized
posting compatibility. Existing category and financial-event rows require no
backfill.

Subcategories v1 provides:

- exactly one optional parent for a category;
- a maximum hierarchy depth of one parent plus one child;
- same-space and same-kind parent/child integrity;
- request-idempotent protected child creation;
- serialized child creation versus parent archival;
- parent archival rejection while any active child remains;
- unchanged global active-name uniqueness within each space and category kind;
- RLS-protected reads and no new direct browser write privilege; and
- real-Postgres rejection, replay, concurrency, migration, and catalog proof.

The following remain outside this milestone: UI, drag-and-drop, reparenting,
arbitrary nesting, category deletion, unarchive, rename, category splits,
post-hoc relabeling, starter packs, automatic categorization, budgets, reports,
icons, and colors.

## Owner-specific Essentials bootstrap

After this database capability is implemented, reviewed, integrated, and
separately approved for production application, Daniel wants the existing
`Essentials` expense category in his production household to receive these 22
English-only children:

1. Rent / Mortgage
2. Electricity
3. Water
4. Internet
5. Phone Bills
6. Fuel / Transportation
7. Groceries
8. Household Cleaning Supplies
9. Personal Care / Toiletries
10. Medications / Pharmacy
11. Health Insurance
12. Car Insurance
13. Car Maintenance
14. Home Maintenance
15. School / Childcare Expenses
16. Baby Expenses
17. Pet Expenses
18. Clothing
19. Subscriptions
20. Eating Out
21. Gifts / Occasions
22. Parent Support

This list is account-specific data, not a migration seed, suggested pack, or
onboarding default. The production operation must use the authenticated
`create_subcategory` command once per child with distinct request IDs, verify a
unique target account, space, and active `Essentials` expense parent before any
write, and preflight all 22 normalized names. It must call all 22 commands in
one explicit transaction and roll back the whole operation if any command
fails, so a partial bootstrap cannot remain. Ambiguous targets and exact
normalized-name conflicts must be reported rather than renamed or silently
skipped. Applying the schema and creating these rows remain two separate
owner-approved production actions.

## Approved product semantics

An existing category with no parent is a root category and can become a parent
without being rewritten. A new child is a normal category row with a stable
parent identity. Parent identity is immutable for the child's lifetime.

Transactions still select exactly one category. A transaction may select a
root or a child. Later read models calculate a root's actual total as direct
root postings plus postings assigned to its children. They must not rewrite or
duplicate the immutable event-category association.

Monthly Budgeting will initially accept targets only for root expense
categories. Child rows provide a breakdown of actual spending beneath that
single parent target. This prevents parent and child targets from being summed
twice. The budgeting restriction belongs to the later budgeting command and is
not implemented by this database milestone.

## Approaches considered

### 1. Nullable self-reference on `public.categories` — selected

Add `parent_category_id` to the existing category identity. Composite foreign
keys and a validation trigger enforce same-space, same-kind, active-root parent
rules. A dedicated protected command creates children while the existing
archive command gains one bounded active-child check.

This is the smallest compatible change. Existing category IDs, event
associations, normalization, RLS, and read access remain authoritative. A
single join supports the approved one-level roll-up.

### 2. Separate category-edge table

An append-only edge table could preserve parent changes as relationship
history. It would require a second lifecycle, current-edge projection,
additional request receipts, more RLS and immutability guards, and ambiguity
about which historical parent owns an event. Reparenting is not approved, so
the extra state is unnecessary.

### 3. Materialized path or recursive hierarchy

A path or closure model would support arbitrary depth and fast ancestor reads.
It would also introduce cycle handling, subtree moves, depth limits, recursive
authorization, and more complex aggregation. Those capabilities exceed the
one-level household budgeting need and create avoidable migration risk.

## Schema extension

The implementation uses one forward-only migration named
`20260910100000_subcategories_foundation.sql`.

Add this nullable column to `public.categories`:

| Column | Contract |
| --- | --- |
| `parent_category_id uuid` | Null for a root; otherwise the immutable ID of an active root in the same space and kind. |

Add a composite foreign key from
`(parent_category_id, space_id, kind)` to the existing unique key
`public.categories(id, space_id, kind)` with `ON DELETE RESTRICT`. Add a check
that a category cannot reference itself.

The database must also prove that a chosen parent is a root and is active.
Because a foreign key cannot express those predicates, a private `BEFORE
INSERT` validation trigger locks the parent `FOR UPDATE` and rejects missing,
archived, or non-root parents. This conflicts with the `FOR NO KEY UPDATE` lock
taken by an ordinary owner archive update, serializing a direct privileged
insert against parent archival in either order. `FOR KEY SHARE` is insufficient
because it permits that archive update concurrently. Existing table-owner-only insert enforcement remains
in place. The archive-transition guard continues to reject changes to identity,
space, kind, names, and the new parent column; only the one-way archive pair may
change. The same guard rejects an active-to-archived root transition while an
active child exists, so the invariant survives an accidental raw `UPDATE`
grant as well as the protected command boundary.

Two bounded access paths are required:

- a partial foreign-key support index beginning with
  `(parent_category_id, space_id, kind)` where the parent is non-null; and
- an active hierarchy listing index on
  `(space_id, kind, parent_category_id, created_at, id)` where
  `archived_at is null`.

The existing active-name unique indexes remain unchanged. Therefore an active
normalized English or Arabic name is unique across the entire space and kind,
not merely among siblings. A root and child cannot both be named “Food,” and
two different parents cannot each have an active child named “Other.” This
keeps selection labels unambiguous and preserves all Categories v1 behavior.

No new table is introduced. Existing RLS on `public.categories` protects the
new parent value automatically, and existing authenticated `SELECT` remains
sufficient for the later typed gateway. No role receives a new raw `INSERT`,
`UPDATE`, `DELETE`, or `TRUNCATE` privilege.

## Protected child-creation command

Add exactly this public capability:

`public.create_subcategory(p_space_id uuid, p_request_id uuid,
p_parent_category_id uuid, p_name_en text, p_name_ar text)` returning one
`id uuid` row.

The command:

1. rejects null required identifiers before fingerprinting;
2. requires the caller to be an active member of the requested space;
3. acquires the existing category request advisory lock;
4. canonicalizes and validates English and Arabic names through the existing
   Categories v1 functions;
5. fingerprints command version, command name, parent ID, and canonical names;
6. replays an exact prior receipt and rejects reuse with different data;
7. locks the parent category row `FOR UPDATE`;
8. rejects a missing, cross-space, archived, or non-root parent;
9. derives the child's kind from the locked parent rather than accepting a
   caller-supplied kind;
10. inserts the child and a command receipt atomically; and
11. maps only the existing active-name unique constraints to the stable
    duplicate-name domain error.

`category_command_requests.command_kind` expands from
`create_category | archive_category` to include `create_subcategory`. The
existing `(space_id, request_id)` primary key remains the single replay
namespace across all category commands. `get_category_command_result` requires
no signature or result change.

Only `authenticated` receives `EXECUTE`. `PUBLIC`, `anon`, and `service_role`
must have no effective execution privilege. The function is `SECURITY DEFINER`
with the same fixed search-path discipline as Categories v1.

## Archive serialization

Replace the body of the existing exact-signature `public.archive_category`
function in the forward migration; do not edit its applied migration.

After request-replay validation, the command locks the target category row
`FOR UPDATE`. If the target is a root and an active child exists, it rejects
with a stable error instructing the caller to archive active children first.
The archive-transition trigger independently enforces the same invariant.
Archiving an active child remains valid. Exact replay of an accepted archive
still returns the original category ID before evaluating current state.

Child creation and root archival acquire locks in the same order: request lock,
then parent/target category row. Therefore their race has two valid outcomes:

- the child commits first, then root archival rejects because the child is
  active; or
- root archival commits first, then child creation rejects because its parent
  is archived.

Neither outcome creates an active child beneath an archived root. Concurrent
child archival may cause a root archival attempt to reject against its visible
active child; the caller may retry with a new request after the child archive
commits. No automatic database retry is introduced.

## Journal and reporting compatibility

`public.financial_event_categories` remains unchanged and continues to store at
most one stable category ID per eligible event. Its existing composite foreign
key already enforces matching space and category kind, including for child
categories. Reversals keep copying the exact original category ID.

No trigger writes a parent association, and no event is duplicated for roll-up.
A later report performs one left join from the selected category to its parent
and groups each event under `coalesce(parent_category_id, category_id)`. Direct
root postings and child postings are each counted once.

Archiving a child or parent never changes historical associations. Archived
rows remain readable to active space members so journal history continues to
render its original labels.

## Migration and compatibility

The migration must apply to both:

- an empty database replaying the full committed journal; and
- a seeded copy of the current 18-migration schema containing active and
  archived categories, categorized events, reversals, and command receipts.

All existing rows receive `parent_category_id = null` and remain roots. The
migration performs no category, event, command-receipt, or balance rewrite.
The existing `create_category`, categorized posting, reversal, category read,
and command-result signatures remain compatible.

There is no down migration. Rollback before production application means
removing the unreleased forward migration and code. Rollback after application
means disabling new child creation at the application boundary while retaining
the nullable column, constraints, children, and history.

## Verification requirements

Real-Postgres tests must first fail against the current schema, then prove:

- valid EN-only, AR-only, and bilingual child creation;
- parent identity, space, and kind derivation;
- exact replay and changed-payload rejection across every category command;
- global per-space/per-kind normalized-name uniqueness across roots and
  children;
- rejection of null identifiers, missing parents, cross-space parents,
  archived parents, self-parenting, and child-as-parent depth expansion;
- active-member success plus non-member, `anon`, and background-role denial;
- no raw category or request-ledger writes even if a client knows the schema;
- immutable child parentage and retained archive/delete/truncate guards;
- root archive rejection with active children and success after all children
  are archived;
- deterministic child-create versus parent-archive concurrency outcomes;
- unchanged categorized posting, reversal inheritance, wallet balances, and
  uncategorized posting;
- empty-journal replay and seeded 18-to-19 migration upgrade preservation;
- exact indexes, constraints, triggers, fixed search paths, RLS, grants, and
  effective `EXECUTE` privileges; and
- a source ratchet that fails if another hierarchy writer or unbounded depth
  path appears.

The final database gate is the focused subcategory suite followed by the full
real-Postgres suite, UI suite, typecheck, operations checks, production build,
manifest verification, and `git diff --check`. No live Supabase command is part
of this verification.
