# Mandatory SQL contract for every future-planning DB task

This is the shared normative SQL checklist, not an implementation task itself.
It resolves ambiguities in the prior planning package so a smaller model does
not select a different money model while writing migrations.

## Exact integration defaults

- Existing financial journal remains the source of actuals; plan commands have
  no posting effect. Current `currency_code`, category parent identity and
  financial command signatures are reused.
- Individual amounts: integer text API → parsed bigint, absolute value at most
  999999999999999 unless an existing command has a narrower shape. Aggregate
  arithmetic uses numeric; aggregate output is text. No float money.
- Audit time is database `now()`, UTC. Business dates are actual valid dates.
  Planning current date is `(now() at time zone 'UTC')::date`. A month is the
  first day; new APIs reject a non-normalized month rather than normalizing it
  silently. Existing public APIs preserve their documented normalization.
- Required arguments reject SQL NULL, JSON null and absent keys before any
  fingerprint/replay operation. Use shape CHECKs ending `IS TRUE` where nullable
  branches could otherwise allow an unknown condition.
- Full snapshots, immutable children and an expected-head chain are the default.
  A snapshot has declared child counts. Deferred checks require exactly those
  counts and the prescribed sums, so a later transaction cannot append extra
  children to already-published history.
- Private helpers are schema-qualified and unavailable to PUBLIC/anon/
  authenticated/service_role. Public RPCs revoke all four roles, then grant
  authenticated EXECUTE explicitly. No app role owns an object or receives
  direct table/sequence mutation privileges.
- Use the existing migration-owner pattern; do not introduce a new broad app
  role, SECURITY DEFINER gateway to arbitrary SQL, or client-controlled search
  path. DEFINER functions use `SET search_path = pg_catalog, extensions` with
  explicit public/private/auth qualification.

## Lock and replay protocol

**Selected default: serialize new planning mutations per space.** This is a
small household application; choose an easily audited lock before partitioning
it for speculative throughput. A later measured bottleneck can narrow it.

1. Validate syntactic input/caps and resolve actor (`auth.uid()`); initial
   active-member check denies unrelated spaces quickly.
2. Lock the `public.spaces` row `FOR UPDATE`, then re-check active membership.
   Existing household lifecycle also locks the space first. Never take a
   membership row lock and then try to acquire the space lock.
3. Lock the new planning request key. Receipt lookup uses `(space_id,request_id)`
   and includes `command`, `actor_id` and normalized payload fingerprint.
   Same actor + same command/payload returns the original result. Different
   actor or payload using the UUID is an idempotency conflict. Removed members
   cannot read/replay the old result.
4. For a new request compare every expected head using `IS DISTINCT FROM`.
   Do not check stale-head conditions before identical-request replay.
5. Lock referenced financial event rows (when linking), then loan rows if used,
   then wallet/category/goal identities in stable UUID order. Never call an
   existing RPC with an incompatible lock order without its task's race proof.
6. Validate current lifecycle and all cross-row invariants, append rows and
   insert the receipt in the same transaction. Run deferred checks at commit.
7. If it fails, the command and receipt roll back together. No “success” receipt
   is inserted before a savepoint that later discards the financial work.

Existing `private.set_monthly_budget_plan` is changed forward in task 03 to
take the space lock before its existing request/category/month locks. It can
then be called from a publication holding that space lock without inverted
planning-lock ordering. Never rewrite the applied migration.

The space lock does not freeze ordinary money posting. Goal cash coverage is
advisory, computed from a single read snapshot and can change with later spending.
A publication may store debt/head observations without blocking ledger commands;
report current consumption and show a changed-dependency flag. Do not promise
binding cash reservations without changing the posting architecture.

## Identity, references and ordering

- Composite FK includes space and currency whenever the relationship has both.
  A root mapping also references the **template's own group line**, not merely
  an arbitrary group identity elsewhere in that space.
- Every expected predecessor references the same logical stream, not just an
  existing bigint. Use composite UNIQUE/FK keys plus two partial unique indexes:
  one initial revision per stream, one successor per nonnull predecessor.
- Every predecessor also requires `expected_revision_id < id` (or its named
  head equivalent); this prevents self-links/cycles and future predecessors even
  when inserting as migration owner. Add a CHECK to every revision/event chain
  in these plans, including table blocks that list only the composite FK.
- For append order use revision/receipt ID, not `created_at` alone. Same
  transaction timestamps can be equal. Audit pages use complete stable keysets.
- Schema-declared caps: 12 groups, 200 roots per template/snapshot, 100 active
  goals per space/currency, 200 relevant goals including restored closed goals,
  20 milestones per goal, 20 financial/allocation lines, 64 KiB command payload.
  Page limit 1…100; history 1…50 unless the file states a narrower cap.
- A database aggregate can scan a bounded date range even if many rows match.
  Use statement/lock timeouts, indexes and realistic EXPLAIN fixtures; never
  impose a client page LIMIT before computing authoritative totals.

## Permissions and invariant layers

For every new history table: RLS enabled with no API write policy; direct table
and sequence privileges revoked from PUBLIC, anon, authenticated, service_role;
statement-level UPDATE/DELETE/TRUNCATE rejection; command-owned INSERT guard;
row checks/FKs/UNIQUEs; deferred cross-row validation where needed.

The INSERT guard must be SECURITY INVOKER so `current_user` is the calling
command owner, not the trigger function owner. Compare it with the table owner
from `pg_class`/`pg_roles`; a SECURITY DEFINER guard would accidentally bypass
the intended test. Privileged migration/admin writes still face row and
cross-row constraints. Do not claim security against a superuser disabling
all defenses; test each intended application defense separately.

A new normalized report projection is private. Public read RPCs authorize
membership and return only the requested space. New plan tables need no public
SELECT grants merely to satisfy an existing invoker report; add a protected read
instead, or forward-fix the verified old read without broadening raw access.

## Error codes and transaction outcome

| SQLSTATE | Message token | Meaning / client action |
| --- | --- | --- |
| 42501 | planning_not_authorized | Sign-in/space access lost; clear visible data |
| 22023 | planning_invalid_input | Field error, no retry until corrected |
| P0001 | planning_idempotency_conflict | UUID belongs to different operation; resolve first |
| 40001 | planning_stale_revision | Reload, show current version; do not blindly resubmit |
| 23514 | named constraint | Invariant rejection; rollback and surface domain message |
| 55P03 / 57014 | lock/statement timeout | Outcome may be unknown over transport; receipt lookup |

Do not expose SQL internals to the UI. A network timeout after COMMIT is not a
rejection. Lookup receipt → accepted means refresh only; absent means explicit
same-request retry. The user can edit a new request only after resolving the old
ambiguous operation. Limit automatic read retries to one; never auto-retry a
financial posting with a fresh request UUID.

## Required SQL evidence before downstream implementation

Normal member success; outsider/removed member/anon/background denial; each
required-NULL and invalid-shape rejection; exact same-payload replay; changed
payload/actor replay refusal; two-connection stale-head race; privilege-bypass
probes with RLS/trigger layers tested separately; cross-space/currency references;
zero-row DELETE and TRUNCATE; empty replay; seeded upgrade preserving old row
digests; SQL catalog/command inventory; numeric maximum and one-minor-unit cases.

See [01-test-recipes.md](01-test-recipes.md) for executable setup and checks.

Technical references checked for this planning pass: [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html),
[transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html),
[function security](https://www.postgresql.org/docs/current/sql-createfunction.html).
These support the row/cross-row, snapshot and DEFINER rules; the repo's tighter
financial policies remain authoritative.
