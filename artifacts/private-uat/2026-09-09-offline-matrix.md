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

Code/docs candidate: `0ebe5cf` (the following evidence update changes only this
matrix and removes one extra blank line from the plan).

| Check | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | Pass; already current, no network download |
| `pnpm check:ops` | Pass; 7 files, 152 tests; secret scan passed for 150 tracked files |
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
fa3adde2796a1daff18303d6b7045751059cfa2f653929e5438a6da4a0676866  dist/index.html
3f71fb129f00d0e45520f2b90521ad7556fd2aef44b222f368770e65830c39b3  dist/assets/categories-page-CHY-qjZG.js
15ae1a7701ecc3b1d9de979d9f1ed2fa1b4e7e8e4b5443dfbf95f00e91dfb07b  dist/assets/dialog-shell-iz08xc-Y.js
fbef30ebd24f756d9061002d8f32063b053b34e4ad54246ae79a586dfef75a92  dist/assets/index-CdWfb-fA.js
29d981a12eac7b6b60b25f35466efaf217dd0a020ed1c953c8e5e046f9402813  dist/assets/index-CgBOJgQr.css
4fdccebb12e7fbe838180662f22e6598efadaddc75c77eb9be32b0bdf83f96f4  dist/assets/wallets-page-DfMxYUvu.js
```

Ready for private live authenticated UAT: **No**.
