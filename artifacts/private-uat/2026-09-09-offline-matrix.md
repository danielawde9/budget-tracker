# Offline synthetic acceptance matrix — 2026-09-09

Release start: `d4bf9d2c39063eb52782188a2f860d3099994361`

Evidence kind: local Vite application plus Playwright-intercepted Auth/REST/RPC
fixtures. All identities and amounts are synthetic. This is not a live UAT
receipt.

| Area | Viewport / locale | State or action | Result | Evidence |
| --- | --- | --- | --- | --- |
| Auth shell | Desktop / EN | Signed out; financial content hidden | Pass | `application.visual.spec.ts` |
| Auth shell | Desktop / EN | Rejected sign-in then retry; sign-out; prior-user clearing | Pass, mocked Auth only | `application.visual.spec.ts` |
| Onboarding | Desktop + mobile / EN | Empty spaces, first space/wallet, ambiguous recovery | Pass, fixture RPCs only | `application.visual.spec.ts` |
| Wallets | Desktop / EN | Create wallet; opening, income, expense, transfer; correction | Pass, all protected names audited | `private-uat.spec.ts`, `wallets.visual.spec.ts` |
| Wallets | Mobile / AR RTL | Empty state, create wallet, reload retention, no overflow | Pass, fixture lifetime only | `private-uat.spec.ts` |
| Wallets | Desktop + mobile / EN/AR | Cross-currency rejection, ambiguous reconciliation, space clearing, history | Pass | `wallets.visual.spec.ts` |
| Loans | Desktop / EN | Opening, cash loan, repayment, target, reversal rejection | Pass, command dispatch and refresh only | `private-uat.spec.ts` |
| Loans | Desktop + mobile / EN/AR | Overview/detail, overlays, overpayment and dependent-repayment recovery | Pass | `loans.visual.spec.ts` |
| Categories | Desktop / EN | Create, categorized expense, archive, archived history after reload | Pass, fixture lifetime only | `private-uat.spec.ts` |
| Categories | Desktop + mobile / EN/AR | Active registers, duplicate rejection, ambiguity, load retry, RTL history | Pass | `categories.visual.spec.ts` |
| Backup readiness | Desktop / EN; mobile / AR | Account warning visible; operator repository reference displayed; README links runbook | Pass | `private-uat.spec.ts`, shell unit tests, `README.md` |
| Supabase Auth/RLS | Private UAT | Real token, expiry, authorization, user isolation | **Blocked** | No environment contact authorized |
| PostgreSQL persistence | Private UAT | Process/service restart and immutable database history | **Blocked** | In-memory fixture is not database proof |
| Private artifact/device | Desktop + mobile / EN/AR | Exact build over private HTTPS; tailnet loss/recovery | **Blocked** | No deployment or remote host contact authorized |
| Backup/restore | Private UAT | Encrypted off-site point, scratch restore, RPO/RTO | **Blocked** | Repository fixtures only |

## Verification receipt

Code/docs candidate: `c9f9608` (the following evidence update changes only this
matrix).

| Check | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | Pass; already current, no network download |
| `pnpm check:ops` | Pass; 7 files, 152 tests; secret scan passed for 151 tracked files |
| Shell static analysis | Blocked; `shellcheck` is not installed; Bash syntax checks passed |
| `pnpm typecheck` | Pass |
| `pnpm test:ui` | Pass; 23 files, 271 tests |
| Focused browser gateway ratchets | Pass; 5 files, 51 tests |
| `pnpm build` | Pass; 104 modules transformed |
| `pnpm test:uat:offline` | Pass; 4 tests, 2 intentional project skips |
| `pnpm test:e2e` | Pass; 36 tests, 34 intentional cross-device skips |
| `pnpm check:uat:scope` | Pass; protected DB, migration, Auth, gateway, Household, Monthly Budget, and Reporting paths unchanged from release start |
| `git diff --check` | Pass after removing the plan's extra EOF blank line |
| `test:db` | Blocked by scope; no local test URL exists and remote database contact was forbidden |

Production build SHA-256 values:

```text
aa0ec7f002c01d5bb0d428d327bbd704fbba1a1764af0ebc93757459fdb7440e  dist/index.html
9d771676c8cbc9ce1ee44251c1164d734cd05acc1e63dab3a2fb76d1a14a0a48  dist/assets/categories-page-CmuvPxE-.js
df6b0f7f083aefca0afc5846dcd5e7d1afdd32d39bf10bb3b97ef680f807b453  dist/assets/dialog-shell-CMZSQLEg.js
4eba3e3a116ad6ebc37ef35bb45c000ed83d2990ad235aff9b5d35ae87e704d3  dist/assets/index-BoxGXpGv.css
f519e7b235a6fde6c3e5089dbf4d974a3415b27a9be6f23c822afc74a80b4f1b  dist/assets/index-DTX77Y34.js
17ebdd1ac2b8fca807d6550a1a3a965060d7933f674432d57e837a56b3b847c4  dist/assets/wallets-page-CeYjOLJM.js
```

Ready for private live authenticated UAT: **No**.
