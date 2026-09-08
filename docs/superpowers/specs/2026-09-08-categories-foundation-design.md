# Categories Foundation Design

## Status and baseline

This specification is the only deliverable for the Categories foundation. It
was prepared from repository commit
`59c2cb4f3cb7b6e20e32cc77dcb343db558bedba` and does not authorize SQL,
migrations, tests, gateways, or UI implementation.

The design extends the verified space, wallet, and immutable financial-journal
boundaries. It does not introduce a second source of financial truth, edit
posted history, or change a derived balance. The existing Wallets client may
continue posting uncategorized events through the existing five-argument
`public.record_financial_event` function without changing its payload.

## Scope

The foundation provides:

- space-owned, explicitly typed income and expense categories;
- independent English and Arabic display names, with at least one present;
- normalized active-name uniqueness without transliteration or stemming;
- protected, request-idempotent create and archive commands;
- an optional immutable category assignment for newly posted income or expense
  events;
- automatic category inheritance when a categorized event is reversed;
- RLS-protected reads, narrow grants, direct-write defenses, and bounded read
  contracts for later clients; and
- real-Postgres rejection, replay, concurrency, migration, and reconstruction
  evidence.

The following remain explicitly deferred: category hierarchy, icons, colors,
automatic categorization, split transactions, budgets, reports, recurrence,
imports, offline synchronization, and default or suggested category packs.
Savings, assets, refunds, exchanges, contributions, interest, fees,
installments, forgiveness, and cross-currency settlement also remain governed
by their existing separate design gates.

## Design principles

1. A category is metadata, not a balance or posting.
2. Categorization is per financial event. Per-movement categorization is a
   split-transaction concern and is not anticipated here.
3. Posted category assignments are immutable. Corrections append a reversal;
   they do not relabel an accepted event.
4. Archiving removes a category from new-entry choices but never breaks old
   journal history.
5. The database, not a client convention, enforces tenant, kind, normalization,
   lifecycle, and request-replay invariants.
6. Existing uncategorized rows and clients remain valid. No synthetic
   "Uncategorized" record is created.

## Approaches considered

### 1. Immutable event-category association and a new posting command — recommended

Keep `financial_events` unchanged and add a one-to-one
`financial_event_categories` relation. Preserve
`public.record_financial_event(...)` exactly for uncategorized callers and add
`public.record_categorized_financial_event(...)` for optional category-aware
income and expense posting. The new command delegates the existing movement
shape and balance work to the verified command, then adds the association in
the same transaction.

This is the safest compatibility boundary. Existing data needs no backfill,
the Wallets gateway needs no immediate change, the old request fingerprint
continues to validate old retries, and category history remains independently
immutable. Reads add one bounded relation lookup per journal page.

### 2. Nullable `category_id` on `financial_events`

This gives the simplest read shape and a direct composite foreign key. It
would, however, require changing or overloading the established
`record_financial_event` signature, versioning fingerprints for old requests,
and replacing the protected function atomically. It creates unnecessary risk
for the verified five-argument PostgREST caller.

### 3. Category on each wallet movement

This could later represent split transactions, but it makes ordinary income
and expense categories ambiguous across multi-movement events and prematurely
commits the foundation to split allocation rules. It also increases joins and
integrity conditions for a feature explicitly deferred.

Approach 1 is recommended because it adds the smallest safe seam around the
current application and journal while preserving a clean future split design.

## Proposed data model

Names below are design-level contracts. The implementation migration must use
timestamped forward-only SQL and preserve the repository's existing naming,
fixed-search-path, ownership, and grant patterns.

### `public.category_kind`

An enum with exactly:

- `income`
- `expense`

A category has one kind for its lifetime. A label may be reused once in each
kind because income and expense pickers are separate semantic namespaces.

### `public.categories`

| Column | Contract |
| --- | --- |
| `id uuid` | Server-generated primary key. |
| `space_id uuid` | Required, `ON DELETE RESTRICT` reference to `spaces`. |
| `kind category_kind` | Required and immutable. |
| `name_en text` | Nullable canonical display name, 1–120 characters when present. |
| `name_ar text` | Nullable canonical display name, 1–120 characters when present. |
| `name_en_key text` | Required when `name_en` exists; generated by the reviewed English normalizer. |
| `name_ar_key text` | Required when `name_ar` exists; generated by the reviewed Arabic normalizer. |
| `created_by uuid` | Authenticated actor, `ON DELETE RESTRICT` reference to `auth.users`; never client-supplied. |
| `created_at timestamptz` | Required, server-generated with transaction-stable `now()`. |
| `archived_by uuid` | Null until archive; `ON DELETE RESTRICT` reference to the authenticated actor. |
| `archived_at timestamptz` | Null until archive; server-generated with `now()`. |

The table enforces:

- at least one of `name_en` and `name_ar` is non-null and non-empty after
  canonicalization;
- each name and key are either both null or both present;
- archive actor and timestamp are either both null or both present;
- `(id, space_id)` is unique for lifecycle-request foreign keys;
- `(id, space_id, kind)` is unique for composite foreign keys; and
- names, keys, kind, space, creator, and creation time never change.

There is no delete, rename, or unarchive operation in this milestone. Archive
is the only permitted row transition and is `NULL -> (archived_by,
archived_at)` exactly once.

Two partial unique indexes enforce active uniqueness independently:

- `(space_id, kind, name_en_key)` where `archived_at is null` and the key is
  non-null;
- `(space_id, kind, name_ar_key)` where `archived_at is null` and the key is
  non-null.

If either supplied language conflicts with an active category of the same kind
and space, the create fails atomically. An archived label may later be reused by
a new category ID; old events continue resolving the archived category they
actually referenced.

### Normalization contract

Display values are NFKC-normalized, trimmed, and have internal whitespace runs
collapsed to a single space before storage. Empty canonical values become
null. The uniqueness keys use the canonical display value and then:

- English: apply deterministic lowercase normalization. Do not perform
  phonetic matching, accent removal, stemming, or transliteration.
- Arabic: apply a tested SQL port of Lucene-style Arabic normalization after
  NFKC. Normalize alef variants, yeh variants, and teh marbuta consistently;
  remove tatweel and Arabic combining marks used as diacritics. Do not stem,
  translate, or compare the result to the English key.

The implementation must define small immutable normalization functions in the
`private` schema, schema-qualify every dependency, and pin behavior with
positive and negative fixtures. Generated stored keys keep the unique indexes
authoritative even if a future privileged writer bypasses the public command.
If the actual PostgreSQL engine cannot express one normalization step as a
safe immutable generated expression, the migration must stop for review rather
than shifting uniqueness to application code.

### `public.category_command_requests`

This append-only table gives category lifecycle commands their own idempotency
domain:

| Column | Contract |
| --- | --- |
| `space_id uuid` | Required space. |
| `request_id uuid` | Browser-generated request UUID. |
| `command_kind text` | Check-constrained to `create_category` or `archive_category`. |
| `request_fingerprint bytea` | SHA-256 of a versioned canonical JSON payload. |
| `category_id uuid` | Result category, composite-referenced to the same space. |
| `actor_id uuid` | Authenticated actor. |
| `created_at timestamptz` | Server-generated with `now()`. |

`(space_id, request_id)` is the primary key. Fingerprints include the command
version and canonical values with explicit nulls: create includes kind,
canonical `name_en`, and canonical `name_ar`; archive includes category ID.
Canonical JSON avoids delimiter ambiguity. Raw user/session data and reusable
credentials are never stored in this request ledger.

The raw table is not selectable by client roles. A narrow protected lookup
function described below supports one-row ambiguous-result reconciliation
without exposing the fingerprint or actor.

### `public.financial_event_categories`

This is an immutable, one-to-one categorization fact:

| Column | Contract |
| --- | --- |
| `event_id uuid` | Primary key; one category at most per event. |
| `space_id uuid` | Required tenant key. |
| `event_kind financial_event_kind` | Required copy used for declarative validation. |
| `category_id uuid` | Required category. |
| `category_kind category_kind` | Required copy used for declarative validation. |
| `created_at timestamptz` | Server-generated with `now()`. |

Add a unique key on `(financial_events.id, space_id, kind)`, then use composite
foreign keys from the association to both the event and category. A check
requires income events to use income categories and expense events to use
expense categories. Reversal rows may carry either kind, but an insert trigger
must prove their `category_id` and `category_kind` exactly match the categorized
event referenced by `financial_events.reversal_of`. No other event kind is
valid in this table.

The association has indexes for `(space_id, event_id)` and
`(space_id, category_id, event_id)`. The primary key already supports direct
event lookup; the second index supports bounded future category history and
report work without authorizing reports now. The category foreign-key columns
are indexed so archive/history checks never require an unbounded scan.

## Protected command contracts

All functions are `SECURITY DEFINER`, use fixed schema-qualified search paths,
obtain the actor from `auth.uid()`, check `private.is_active_member`, revoke
execution from `PUBLIC`, and grant only exact signatures to `authenticated`.
The functions never accept an actor or archive timestamp from the client.

### `public.create_category`

Proposed signature:

```text
create_category(
  p_space_id uuid,
  p_request_id uuid,
  p_kind category_kind,
  p_name_en text,
  p_name_ar text
) returns table (id uuid)
```

The command:

1. checks authentication and active membership;
2. acquires a transaction advisory lock scoped by `category`, space, and
   request ID;
3. canonicalizes and validates both names;
4. computes the versioned fingerprint;
5. returns the original category for an identical replay, but rejects a reused
   request ID with any different canonical payload or command kind;
6. inserts the category and request result in one transaction; and
7. maps an active-name unique violation to a stable, safe category-name
   conflict instead of exposing index details.

Concurrent identical requests return one category. Concurrent different
requests for the same normalized active name leave exactly one active category.

### `public.archive_category`

Proposed signature:

```text
archive_category(
  p_space_id uuid,
  p_request_id uuid,
  p_category_id uuid
) returns table (id uuid)
```

The command locks the request and category row, verifies same-space active
membership, and returns the original result for an identical request replay.
It rejects a changed-payload replay, a missing/cross-space category, or a new
request against an already archived category. It then records `archived_by` and
`archived_at` and appends the request result atomically. Archiving is allowed
even when historical events reference the category because foreign keys use
`RESTRICT` and the row is retained.

### `public.record_categorized_financial_event`

Proposed signature:

```text
record_categorized_financial_event(
  p_space_id uuid,
  p_request_id uuid,
  p_kind financial_event_kind,
  p_effective_date date,
  p_movements jsonb,
  p_category_id uuid
) returns table (id uuid)
```

`p_category_id` is required for this command. Optional categorization at the
feature boundary means callers use this command when a category is chosen and
the unchanged `public.record_financial_event` when it is not.

The command first acquires the same existing financial request lock. If the
request already exists, it validates the existing base request fingerprint and
requires an existing association to the same category before returning the
original event. A missing or different assignment is a changed-data replay and
is rejected. This combines the existing base fingerprint with category ID as
the complete categorized-request fingerprint without invalidating historical
fingerprints.

For a new request, the command requires kind `income` or `expense`, then loads
an active same-space category of the matching kind under `FOR KEY SHARE`, so a
concurrent archive is ordered after the posting decision. It invokes the
existing `public.record_financial_event` for all movement parsing, amount
bounds, same-space wallet checks, event shape checks, event creation, and
wallet movements. It inserts the category association before the surrounding
transaction can commit. A failure in either part leaves no event, movement, or
association.

The existing `public.record_financial_event` keeps its signature and legacy
fingerprint algorithm. Its identical-replay branch gains one fail-closed check:
if the request belongs to a categorized event, an uncategorized replay is
rejected as changed data. All existing uncategorized callers and rows otherwise
retain their exact behavior.

Openings and transfers are rejected by the categorized command. Loan opening,
lending, borrowing, repayment, and planning commands expose no category
parameter, and the association constraints reject all loan event kinds.
Callers cannot directly categorize a reversal.

### `public.get_category_command_result`

Proposed signature:

```text
get_category_command_result(
  p_space_id uuid,
  p_request_id uuid
) returns table (
  command_kind text,
  category_id uuid,
  created_at timestamptz
)
```

This is a read function, not a mutation command. It verifies active membership
inside the fixed-search-path SECURITY DEFINER body and returns zero or one row
from the unique `(space_id, request_id)` key. It exposes neither request
fingerprints nor actors and gives future gateways a bounded reconciliation
surface without granting the raw request table.

### `public.reverse_financial_event`

The signature and existing request fingerprint stay unchanged. After the
existing wallet/loan reversal validation and event creation, the function
copies the original event's category association, if one exists, to the new
reversal event. It does so in the same transaction and regardless of whether
the category is now archived. The reversal association trigger proves that the
copy exactly matches the original.

This produces intuitive net category math later: a categorized income or
expense and its reversal carry the same category while their wallet movements
cancel. Reversing an uncategorized event remains uncategorized. Replacement
income or expense is a new event and may intentionally choose the same,
another, or no category under a new request ID.

## Authorization, RLS, grants, and direct-write prevention

The default in this design is that any active member may create and archive
categories, matching current wallet and financial commands. The owner-role
alternative remains an explicit owner decision below.

- Enable RLS on `categories`, `category_command_requests`, and
  `financial_event_categories`.
- Member SELECT policies derive tenant visibility only through the indexed
  `private.is_active_member(space_id)` lookup. No insert, update, or delete RLS
  policy exists for application roles.
- Grant authenticated SELECT only on `categories` and
  `financial_event_categories`. Do not grant raw request-ledger SELECT; grant
  exact execute on the safe command-result lookup instead.
- Revoke all table privileges from `anon` and all write privileges from
  `authenticated` and `service_role`.
- Revoke all function execution from `PUBLIC`, then grant only the exact public
  read/mutation signatures required by the client.
- Category request rows and event-category associations reject UPDATE, DELETE,
  and TRUNCATE through statement/row history guards as appropriate.
- Categories reject DELETE and TRUNCATE universally. An UPDATE guard permits
  only the one-way archive field transition and rejects any other column
  change.
- Command-owned INSERT/UPDATE triggers require the effective SQL role to be the
  table owner. This preserves migration/recovery access and SECURITY DEFINER
  command writes while blocking direct client roles even if a table grant is
  accidentally introduced.
- The financial command inventory and catalog ratchet must classify
  `record_categorized_financial_event`, include the association among protected
  financial-history tables, and continue detecting every actual journal
  writer. Category create/archive commands are metadata lifecycle commands,
  not money-posting commands.

Operational migration ownership remains outside the application boundary. No
policy or grant may rely on a client-supplied space or actor without verifying
membership and `auth.uid()` inside the function.

## Read and client compatibility strategy

### Existing clients

- Existing financial rows remain uncategorized; there is no data rewrite or
  default-category backfill.
- The current Wallets gateway keeps calling the five-argument
  `public.record_financial_event` with its existing payload and request retry
  behavior.
- Existing balance, loan, and journal projections do not change because a
  category association has no amount.
- Every current real-Postgres and UI test must remain green before category
  tests are considered.

### Future category-aware clients

A later typed gateway may expose:

- active-category pages filtered by selected space and kind, ordered by
  `(created_at, id)` with a keyset cursor and a default page of 50, hard-capped
  at 100;
- one safe command-result lookup by `(space_id, request_id)` for ambiguous
  create/archive reconciliation; and
- journal-page category resolution by querying associations for at most the 20
  event IDs already loaded, then fetching at most 20 referenced categories.

Active pickers filter `archived_at is null`. Historical resolution never does:
it follows the event's category ID and returns the retained English and Arabic
names plus archive status. When only one language is present, the UI may display
that stored name as a fallback inside `<bdi>`; it must not transliterate or
manufacture the missing language.

Every browser query supplies an explicit limit and rejects a `limit + 1`
response instead of silently truncating. Deep category lists use keyset, not
OFFSET, pagination. A space change clears prior category data and invalidates
late responses under the same user-scoped selected-space rules already used by
Wallets and Loans.

For ambiguous request-bearing mutations, the client first reads the safe
request result. If found, it refreshes and reports reconciled success. If not
found, it may offer only an explicit retry with the identical request ID and
canonical payload. Editing any field creates a new request UUID.

## Failure model

Commands fail closed and use the repository's established safe database error
surface:

- SQLSTATE `42501`: authentication or active membership is missing;
- SQLSTATE `P0001`: invalid names, kind mismatch, cross-space or archived
  category, unsupported event kind, already archived category, or changed-data
  request replay;
- mapped stable `P0001`: an active English or Arabic normalized name already
  exists for the same space and kind; and
- existing financial errors remain unchanged for movement shape, wallets,
  amounts, reversals, and request collisions.

Errors expose no normalized index name, fingerprint, token, full record, or
other user's data. Expected validation errors roll back the entire transaction.
Unexpected constraint errors remain loud and are not converted into success.

## Migration strategy

Implementation should use one reviewed forward-only migration for the coherent
database change, followed by later forward fixes if evidence requires them:

1. preflight the current PostgreSQL 17 schema, function signatures, grants,
   policies, triggers, and seeded-data assumptions;
2. add the category enum and private normalization helpers;
3. add categories, lifecycle request records, the safe result lookup,
   constraints, partial/composite indexes, RLS, ownership guards, and history
   guards;
4. add the event-category association and the supporting unique event key;
5. create category lifecycle commands and the categorized financial command;
6. replace only the bodies of the existing financial and reversal functions
   needed for cross-mode replay rejection and category propagation, preserving
   their public signatures and legacy fingerprint rules;
7. apply exact revokes/grants, including `service_role` write revocation;
8. update the financial command inventory and catalog coverage ratchet in the
   same implementation change; and
9. prove migration application both on an empty database and on a seeded copy
   containing uncategorized general events, loan events, and reversals.

No category rows are seeded and no existing event is backfilled. The migration
must be applied only to the dedicated Budget development database through the
repository's normal process; it must not be auto-pushed or applied to Sandooq
or production.

## Real-Postgres test matrix

### Schema and normalization

- Reject both names absent, empty, whitespace-only, over 120 characters, or
  empty after normalization.
- Accept English-only, Arabic-only, and bilingual categories without filling
  the missing language.
- Prove NFKC, case, and whitespace variants collide in the English active key.
- Prove alef/yeh/teh-marbuta variants, tatweel, and diacritic variants specified
  by the Arabic normalizer collide.
- Prove unrelated Arabic names remain distinct and no Arabic/English
  transliteration comparison occurs.
- Reject a duplicate when either supplied language key conflicts in the same
  space and kind; allow the same key in another space or the other kind.
- Allow reuse after archive while retaining both old and new IDs and names.

### Authorization and direct writes

- An active member can read and, under the default, manage categories in the
  member's space.
- Another-space users and anonymous users cannot read, create, archive,
  reconcile, or infer category existence.
- `authenticated` and `service_role` have no direct INSERT, UPDATE, DELETE, or
  TRUNCATE privileges on the new tables.
- Temporarily grant authenticated table writes and prove RLS still denies them;
  separately simulate an inappropriate direct effective role and prove the
  ownership/history guards reject insertion, relabeling, unarchive, delete,
  and truncate attempts.
- Verify every new public function has a fixed search path, no PUBLIC execute,
  and only the intended authenticated grant.

### Category command idempotency and concurrency

- Identical create and archive replays return their original category ID and
  produce one request record.
- Reusing a request ID with changed command, kind, name, or category ID fails.
- Concurrent identical creates produce one category; concurrent different
  request IDs for one normalized active name leave one success and one safe
  conflict.
- Archive has one transaction-stable server timestamp, cannot be repeated under
  a new request, and never deletes historical data.
- A command failure leaves neither partial category state nor a request result.

### Financial integration and compatibility

- The unchanged uncategorized command still posts opening, income, expense,
  and transfer events and passes all current tests.
- Categorized income and expense produce the same verified wallet effects plus
  exactly one matching immutable association.
- Reject categorized opening balance, transfer, every loan event shape, and a
  caller-supplied reversal category.
- Reject a wrong-kind, archived, missing, or cross-space category without an
  event, movement, or association.
- Identical categorized retries return the original event; a changed category,
  movement, date, or kind under the same request ID fails.
- An uncategorized replay of a categorized request, and a categorized replay of
  an uncategorized request, fail as changed data.
- Concurrent identical categorized requests create one event, the expected
  movements, and one association.
- Reversing a categorized event copies the category even after archive; wallet
  effects cancel and both immutable rows remain resolvable.
- Reversing an uncategorized event stays uncategorized. Loan-aware reversal and
  dependent-repayment rules remain unchanged.
- Projection reconstruction from journal movements remains identical before
  and after category introduction.

### Bounded reads and migration evidence

- Active list queries honor the requested/default/hard cap and keyset cursor;
  journal category resolution cannot exceed the loaded 20-event page.
- Category command reconciliation reads at most one result and is tenant
  scoped.
- Relevant foreign-key, active-list, request-ID, and history probes use their
  intended indexes under representative seeded data after `VACUUM ANALYZE`;
  tests do not force an unrealistic plan.
- Apply the full journal from empty and apply only the new migration to a seeded
  copy; compare existing event IDs, fingerprints, movements, loans, balances,
  reversals, grants, and visible results before and after.

## Forward-fix and operational considerations

Applied migrations are never edited or rolled back destructively. If a command
or grant is wrong, a new migration first revokes unsafe execution, then replaces
the function or grant and reruns the full rejection matrix. If normalization is
wrong, stop category creation, introduce versioned replacement keys/functions,
audit collisions, and migrate deliberately; do not silently rewrite displayed
names or merge category IDs. Existing associations and request records remain
append-only evidence.

If a unique index cannot be created on seeded data, the migration must fail and
report only safe aggregate collision counts for owner review. It must not pick a
winner, archive rows, or alter names automatically. Category-table growth and
query plans should be measured before introducing caches, search services, or
partitioning.

## Dependencies and follow-on work

The database design depends only on existing `spaces`, `auth.users`,
`private.is_active_member`, `private.lock_financial_request`, `pgcrypto`,
`financial_events`, `record_financial_event`, `reverse_financial_event`, and
their established history/grant model. It adds no npm package, external
service, CDN, search engine, or new PostgreSQL extension.

Later, separately approved layers would add real-Postgres helpers/tests, update
the command inventory, introduce a typed Categories gateway and source ratchet,
and finally add category pickers and archived-history labels to Wallets. Those
are not part of this specification deliverable.

## Unresolved owner decisions

These do not justify guessing during implementation. The recommended defaults
are recorded so the consequences are explicit:

1. **Who manages categories?** Recommended default: every active space member,
   consistent with current wallet and posting commands. Owner-only management
   would require a role-aware private authorization helper plus owner/member
   acceptance and rejection tests before command implementation.
2. **Are active names unique separately by income and expense kind?**
   Recommended default: yes, so a household can use the same human label on
   both sides without merging their meaning. A single shared namespace would
   remove `kind` from both partial unique indexes and change conflict copy.
3. **Should a future onboarding flow seed starter categories?** Recommended
   default: no. Starter content introduces product, locale, and deletion/archive
   policy decisions and should be a separate, idempotent onboarding design.

No implementation plan or migration should begin until the owner has reviewed
this specification and either accepts these defaults or records replacements in
the append-only decisions ledger.
