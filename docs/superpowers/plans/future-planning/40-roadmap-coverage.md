# 40 — Complete roadmap coverage and execution routing

All **39 original roadmap IDs** have a next executable task. A next task can be
verification or evidence collection; that is deliberately different from claiming
every financial integration is already safe to implement. Number ranges are
execution references, not authorisation to combine DB, gateway and UI in one task.
Start with [00-start-here.md](00-start-here.md). All files below are proposals.

| ID | Outcome | Work files/steps | First detailed file | Execution boundary |
| --- | --- | --- | --- | --- |
| N1 | Monthly amount planning | 02–08 | [02-reporting-verification.md](02-reporting-verification.md) | Verify existing SQL, then allocation DB → gateway → UI |
| N2 | Reports and drilldown | 02,06–08,23,25,26d | [23-journal-search-db.md](23-journal-search-db.md) | DB reports → journal gateway → report UI |
| N3 | Household profiles/invitations | 57,37–39 | [57-existing-feature-verification.md](57-existing-feature-verification.md) | Verify existing layer first; profiles DB → gateway → UI |
| X1 | Notes/payees | 57 | [57-existing-feature-verification.md](57-existing-feature-verification.md) | Verify selected existing DB/gateway/UI layer; no duplicate subsystem |
| X2 | Both exchange directions | 27,28,35,36 | [28-two-way-exchange-db.md](28-two-way-exchange-db.md) | DB integration audit → exchange DB → gateway → UI |
| X3 | Repeat/favourites/installability | 57,26b | [26-daily-tools-ui.md](26-daily-tools-ui.md) | Verify existing repeat; scoped UI preferences/manifest |
| X4 | Search beyond loaded history | 23,25,26a | [23-journal-search-db.md](23-journal-search-db.md) | DB → gateway → UI |
| X5 | Complete bounded export | 24,25,26a | [24-export-db.md](24-export-db.md) | Manifest DB → streaming gateway → download UI |
| X6 | Wallet rename/archive/restore | 57 | [57-existing-feature-verification.md](57-existing-feature-verification.md) | Existing-layer verification, repair only confirmed failures |
| X7 | Human actor attribution | 37,38,39a | [37-household-profiles-db.md](37-household-profiles-db.md) | DB display read → gateway → UI |
| X8 | Optional category packs | 26c | [26-daily-tools-ui.md](26-daily-tools-ui.md) | UI over existing approved category commands |
| L1 | USD purchase/LBP change | 27,34a,28,29,35,36 | [29-mixed-purchase-db.md](29-mixed-purchase-db.md) | Expense facts prerequisite, then atomic money DB → gateway → UI |
| L2 | Dated manual reference rates | 30,35,36 | [30-reference-rates-db.md](30-reference-rates-db.md) | DB → gateway → UI; no auto-provider |
| L3 | Cross-currency loan repayment | 27,28,31,35,36 | [31-cross-currency-repayment-db.md](31-cross-currency-repayment-db.md) | DB → gateway → UI |
| L4 | Loan people/due/instalments/forgiveness | 32a–c,35,36 | [32-loan-planning-db.md](32-loan-planning-db.md) | Three separate DB steps → matching gateway/UI; fee terms evidence remains explicit |
| L5 | Physical cash count | 27,33,35,36 | [33-cash-count-db.md](33-cash-count-db.md) | DB → gateway → UI |
| P1 | Recurring bills/income | 14–16 | [14-recurring-db.md](14-recurring-db.md) | DB schedules and settlement → gateway → UI |
| P2 | Signed opt-in rollover | 20–22 | [20-month-copy-rollover-db.md](20-month-copy-rollover-db.md) | DB close/carry → gateway → UI |
| P3 | Copy previous month | 20–22 | [20-month-copy-rollover-db.md](20-month-copy-rollover-db.md) | DB preview/atomic copy → gateway → UI |
| P4 | Short/long goals and milestones | 09–13 | [09-goals-schema-db.md](09-goals-schema-db.md) | Schema → commands → progress → gateway → UI |
| P5 | Available after commitments/daily guide | 17–19 | [17-available-cash-db.md](17-available-cash-db.md) | DB deduped commitments → gateway → UI |
| P6 | Percentages and planned/actual bars | 03–08 | [04-allocation-schema-db.md](04-allocation-schema-db.md) | Foundation → allocation schema/commands/reads → gateway → UI |
| P7 | Split expense | 27,34a–b,35,36 | [34-split-refund-db.md](34-split-refund-db.md) | Semantic allocation DB → split command → gateway → UI |
| P8 | 30/60/90-day cash outlook | 17–19 | [17-available-cash-db.md](17-available-cash-db.md) | DB scenario → gateway → UI |
| P9 | Pay-date planning | 46–48 | [46-pay-date-db.md](46-pay-date-db.md) | DB cycle assignments → gateway → UI |
| H1 | Weekly check-in | 41,38,39b | [41-review-preferences-db.md](41-review-preferences-db.md) | Review-state DB → gateway → UI |
| H2 | Explainable insights | 41,39b | [39-household-checkin-ui.md](39-household-checkin-ui.md) | Pure predicates/UI with optional persisted dismissal boundary |
| H3 | Mine/theirs/ours labels | 37–39 | [37-household-profiles-db.md](37-household-profiles-db.md) | Presentation metadata DB → gateway → UI; no privacy promise |
| H4 | Hide amounts | 39c | [39-household-checkin-ui.md](39-household-checkin-ui.md) | User/device UI preference |
| H5 | Opt-in monthly recap | 49,42 | [49-recap-delivery-db.md](49-recap-delivery-db.md) | DB preferences/queue → Worker; real send separately requested |
| E1 | SMS to reviewed draft | 50 | [50-sms-evidence.md](50-sms-evidence.md) | Executable evidence task; sanitized real sender examples missing |
| E2 | Receipt to reviewed draft | 51 | [51-receipt-evidence.md](51-receipt-evidence.md) | Executable evidence task; consent/provider/retention decision required |
| E3 | CSV import | 43–45 | [43-csv-import-db.md](43-csv-import-db.md) | Fixed-template DB → parser/gateway → UI; no guessed bank format |
| E4 | Offline entry | 52 | [52-offline-evidence.md](52-offline-evidence.md) | Executable browser feasibility and device-policy task |
| E5 | Bilingual quick text | 44b,45 | [44-input-gateway.md](44-input-gateway.md) | Deterministic parser → reviewed UI; no provider dependency |
| E6 | Savings circles | 53 | [53-savings-circle-evidence.md](53-savings-circle-evidence.md) | Executable financial-model evidence task; actual circle rules required |
| E7 | Assets/net worth | 54 | [54-assets-evidence.md](54-assets-evidence.md) | Executable valuation/ownership evidence task |
| E8 | Household settle-up | 55 | [55-settlement-evidence.md](55-settlement-evidence.md) | Executable attribution/consent evidence task |
| E9 | Pricing/entitlements | 56 | [56-pricing-evidence.md](56-pricing-evidence.md) | Executable business/provider evidence task |

## Additional retained work

- Cash refunds/reimbursements: [34c](34-split-refund-db.md) defines partial cash
  refunds and goal restoration. Store credit and another member's reimbursement
  require the ownership model in [55](55-settlement-evidence.md); neither is Undo.
- Interest/fees: [32](32-loan-planning-db.md) contains a bounded agreement-evidence
  task. A smaller model must not invent a compound-interest or payment-waterfall rule.
- Bank sync, unattended posting and automatic FX conversion are not activated by
  any task. They were not prerequisites for the requested percentage/goals feature.

## Priority and useful first release

1. 02→03→04→05→06→07→08 delivers expected-income percentages, category budgets,
actual bars and signed over/under amounts. Existing journal/categories stay intact.
2. 09→10→11→12→13 adds short/long goals, deadlines, milestones and realistic coverage.
3. 14→15→16→17→18→19 adds bills, partial payments, leftover cash and cash outlook.
4. 20→21→22 adds explicit month copy/close/carry. Remaining rows are selected by need.

For any task prompt: name its file and layer, read prerequisites, require its red/
green tests and evidence record, stop at its commit. A missing prerequisite is
reported precisely; it is never replaced by a mock pretending to prove SQL.
