# Spending report

Approved direction: choose a reporting period, see exact currency-separated
totals, understand category/group totals, and inspect the matching transactions.
Preserve the existing Control Room design and English/Arabic support.

## Decisions

- Default to this month through the budget's today. Add previous/next month,
  last month, last 30 days, year to date, and inclusive custom dates.
- Compose the existing complete monthly activity reads with bounded concurrency.
  Filter exact endpoints and deduplicate entries before calculating totals.
  This supports existing deployed databases without a migration.
- Keep purchases/fees, refunds, and net expenses separate, including signed
  corrections. Exclude transfers, allocations, and investment/loan principal;
  include purchases paid from savings once in the purchased category.
- Show both currency totals. The currency selector controls category/group and
  transaction detail. Preserve historical group membership where available.
- Reuse entry detail and correction dialogs. Page the displayed transaction list
  without limiting the records used for totals. Load errors must not show a
  partial range as a finished total.
- Implement the four first-priority report layers. Comparisons/trends remain
  the follow-up described in the research, outside this change.

## Tasks and verification

- [x] Model: `spending-report.ts` and tests for date boundaries, leap years,
  cross-month pagination/deduplication, signed corrections, split transactions,
  currency separation, historical groups, and purchase-source allocations.
- [x] UI: extend `expenses.tsx`, report controls/breakdown components, bilingual
  copy, metadata, and canonical shared CSS/documentation. Test presets, custom
  validation, visible dual totals, grouped drilldown, and source entry details.
- [x] Verify: full UI suite and production build; browser-check 1440/390/320px
  EN/AR, custom cross-month dates, group/category drilldown, and currency views.
- [x] Fresh review of source and captures, apply material fixes, and record final
  test/build results here. Preserve work for the user; no deployment is requested.

## Execution notes

- Dependencies reuse the primary checkout's lockfile-matched installation in an
  ignored local node_modules directory; the offline package cache was incomplete.
- The report loads lazily as a 15.14 kB chunk, preserving the existing initial
  application chunk below its 500 kB warning threshold.
- Initial verification: 265 UI tests and build passed; browser matrix covered
  both currencies, inclusive cross-month dates, grouping, and original records.
- Fresh review found wallet-only investment fees missing. Added a report-only
  Investment fees category, signed reversal handling, and regressions preventing
  duplicate category-backed fees. Final verification follows the review fix.
- Final verification: all 268 UI tests and the production build passed. The
  complete browser matrix passed again with a sample investment fee, including
  both currencies and EN/AR at 1440, 390, and 320px. The reviewer scored the fee
  correction resolved with no material regressions from the fix. Temporary
  browser harness source was removed. Existing detector warnings were outside
  this change; no second detector pass was run.
