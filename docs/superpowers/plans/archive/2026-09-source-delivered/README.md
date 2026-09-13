# September source-delivered plan archive

Archived on 2026-09-13 after checking current `main` ancestry, implementation
commits, migrations/source paths, and focused verification commits. These plans
are historical execution instructions, not the current work queue. Their
unchecked boxes are retained as historical authoring records and are not used as
the completion signal.

**Archive meaning:** source delivery is present on `main`. It does not assert a
live migration, hosted deployment, authenticated UAT, production acceptance, or
that later redesigns were never made.

| Archived plan | Source-level evidence on `main` | Archive note |
| --- | --- | --- |
| Budget foundation | `d2098a7` | Foundation/journal red tests landed. |
| Loans ledger database | `c439f35` | Verification record follows the protected loan-command commits. |
| Loans UI | `8fdf633` | Delivery boundary recorded after UI and visual-flow tests. |
| Authentication/onboarding/application shell | `ca5bbed` | Authenticated-flow delivery record. |
| Wallets and journal UI | `59c2cb4` | Wallet/journal user-flow test delivery. |
| Categories database foundation | `7b6583d` | Categories verification record after hardening. |
| Household membership database | `396d001` | Final household database re-review record. |
| Categories application/UI | `284839d` | Categories application delivery record. |
| Household membership UI | `448f5cf` | Responsive membership-flow coverage. |
| Subcategories database | `207884c` | Reviewed database branch merged; later test hardening remains on `main`. |
| Subcategories application/UI | `ece861f` | Subcategory UI-flow verification. |
| Household invitation delivery | `a24e5e3` | Delivery boundary integrated; enabling provider secrets remains an operation. |
| Wallet lifecycle database | `33dcaeb` | Seeded-upgrade proof for lifecycle migration. |
| Wallet lifecycle application/UI | `8eeeee0` | End-to-end lifecycle coverage. |
| Financial workspace redesign | `8e8acea` | Superseded visually by later compact/control-room work. |
| Compact light/mint workspace | `0a92df3` | Merged; superseded visually by Control Room. |
| Task-oriented navigation | `35e5fc0` | Merged; later Control Room composes the current shell. |
| Control Room redesign | `49f52aa` | Merged source delivery; product UAT/deployment stay separate. |

If a regression is found, open a new bounded verification/fix plan from the
current source rather than reopening one of these historical checklists.
