# Journal CSV export design

## Status and scope

This implements register item X5 for the Journal: an explicit, user-initiated
CSV export of the space's full transaction history, assembled in the browser
from the already-authorized bounded journal pages. It starts from `main`
commit `3318f00`.

No new SQL, command, table, or RLS change: export reads through the existing
`loadHistoryPage` projection that the Journal already uses, so the caller's
membership remains the only authorization boundary. Nothing is exported
automatically; the owner clicks Export.

## Contract

`buildJournalCsv(events, locale)` in
`src/features/wallets/journal-csv.ts` returns `{ csv, rowCount, totals,
truncated }`:

- One row per wallet movement, carrying its event's date, kind, label
  (payee, then category name, then kind label — the same precedence the
  Journal rows use), note, wallet name, currency, and signed minor amount.
- Text fields are quoted when they contain a separator, quote, or newline;
  inner quotes are doubled. A cell that starts with `=`, `+`, `-`, or `@`
  is prefixed with a single quote so spreadsheet formula injection is
  neutralized. Amounts stay exact text minor units; no float formatting.
- Headers and the totals footer follow the active locale (EN or AR). The
  footer carries, per currency, the net movement sum in exact minor units so
  an exported file reconciles to the exported rows.
- A header comment line records the export's snapshot high-water
  (latest `created_at` and event id included) so two exports can be
  compared and a later export can resume after that watermark.
- Bounds: at most 100,000 movement rows and 20 MiB of CSV per file. When a
  bound is hit, `truncated` is true and the footer says so; the caller asks
  for a narrower range instead of silently delivering a partial file.

`useWallets` gains `exportJournalCsv()` which pages through
`loadHistoryPage` (deduplicating by event id across pages) until the cursor
is exhausted or the row cap is reached, then returns the built file. The
Journal screen renders an Export button, shows pending and failure states,
and triggers the browser download only from the explicit click.

## Testing

Unit: injection and quoting edge cases, bilingual headers and footers,
exact-money totals, snapshot high-water, cap truncation. Hook: paged
assembly, dedupe, cap, and failure surfacing. Browser: the explicit click
downloads a file. The visual spec asserts the control exists, stays
contained, and that a download begins.

## Deferred work

Server-side export jobs, resumable/ranged exports beyond the cap, and
formats other than CSV remain separate milestones.
