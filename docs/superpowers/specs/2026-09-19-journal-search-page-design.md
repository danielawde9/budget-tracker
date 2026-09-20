# Journal search page design

## Status and scope

This implements register item X4: search beyond loaded journal history. It
starts from `main` commit `d7faf60`, which added client-side search over the
loaded Journal page. The client-side filter stays for the loaded list; a new
bounded SQL function backs full-history text search.

One reviewed SQL read, `public.journal_search_page`, is added. No table, RLS
policy, command, trigger, or financial calculation changes. The function is
`stable`, runs with the caller's privileges (security invoker), and reads only
already-RLS-protected tables. Grants follow the existing projection pattern:
execute to `authenticated` only, revoked from `public`, `anon`, and
`service_role`.

## Function contract

```text
public.journal_search_page(
  p_space_id uuid,
  p_from date default null,
  p_to date default null,
  p_wallet_id uuid default null,
  p_root_category_id uuid default null,
  p_payee_id uuid default null,
  p_min_amount_minor bigint default null,
  p_max_amount_minor bigint default null,
  p_query text default null,
  p_cursor text default null,
  p_limit integer default 50
)
```

Returns the same event columns the loaded-history read returns:
`id, space_id, request_id, kind, effective_date, actor_id, reversal_of,
created_at`. The gateway composes movements, descriptions, and category labels
through its existing checked reads, exactly as it does for loaded pages.

Semantics:

- Sort is `effective_date desc, created_at desc, id desc` with `created_at`
  truncated to milliseconds so the keyset survives JSON timestamp
  serialization. The cursor is the strict keyset
  `(effective_date, created_at, id)` encoded as `date|timestamptz|uuid`; a
  malformed cursor raises `invalid_input`.
- `p_limit` must be 1..100 (null means 50). The function returns at most
  `p_limit` rows; callers that need a has-more signal request one extra row
  and slice, exactly like the existing loaded-history lookahead. The cursor
  of the next page is derived from the last returned row.
- `p_from`/`p_to` are inclusive date bounds. When both are provided the window
  must not exceed 366 days; `p_from` after `p_to` raises `invalid_input`.
  A null bound is unbounded, so whole-history search is expressed as two nulls.
- `p_query` is trimmed, capped at 120 characters (longer raises
  `invalid_input`), and matched as a case-insensitive substring against the
  event note, payee name, wallet names, and associated category names (child
  or root). `%` and `_` are escaped so they match literally. Null or empty
  query means no text filter. Arabic matches as authored (`lower` is the
  identity for Arabic).
- `p_wallet_id` keeps events with at least one movement on that wallet;
  `p_root_category_id` keeps events whose associated category's root
  (two-level tree) matches; `p_payee_id` keeps events whose description names
  that payee; `p_min_amount_minor`/`p_max_amount_minor` keep events having at
  least one movement whose signed minor amount is within the inclusive range.
- All parameters compose with AND. The space comes only from `p_space_id`; the
  caller's RLS membership remains the isolation boundary, and the function
  adds no cross-space reads.

## Index direction

`financial_events_space_date_idx (space_id, effective_date desc,
created_at desc)` predates deterministic keyset paging. It is replaced by
`financial_events_space_keyset_idx (space_id, effective_date desc,
created_at desc, id desc)`, which serves both the existing loaded-history
shape and the new keyset predicate. No full-text index in this milestone; text
matching uses bounded `position` predicates on space-scoped rows, and a full
-text index is added only after measurement, per the register.

## Gateway and UI

`WalletsGateway` gains `searchJournal(spaceId, input)` returning the same
`JournalPage` shape as `loadHistoryPage`, with `nextCursor` now the opaque
keyset string. The Supabase gateway validates inputs (limit, cursor shape,
query length, date order) before the RPC and normalizes rows through the
existing `composeEvents` path.

The Journal screen keeps its loaded-history list and kind chips. When the
search box holds text, the screen searches server-side instead: first page on
submit/debounce, Load more follows the keyset cursor, and kind chips keep
filtering the visible results client-side. The "Matches are limited to loaded
entries." note now appears only for the loaded-history (no-query) state,
because a text search covers the full history.

## Test-first verification

Database integration tests (real disposable Postgres) prove: text matches on
note, payee, wallet, and category names; case-insensitivity; an apostrophe
query (`O'Brien`); an Arabic query; literal `%` handling; inclusive date
bounds and the 366-day window validation; keyset paging across same-timestamp
ties and an exact final page; limit bounds; wallet/root/payee/amount filter
composition; space isolation for a non-member and across spaces; and the
execute-grant boundary. Gateway tests prove exact RPC forwarding, validation,
and normalization reuse. UI tests and the visual spec prove the search-driven
list, Load more over search pages, and the honest scope note.

## Deferred work

Date-range UI fields, saved filters, split-expense-aware labels, and any
full-text index remain separate milestones.
