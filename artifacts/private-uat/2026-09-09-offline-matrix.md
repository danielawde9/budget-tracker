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
| Backup readiness | Desktop / EN; mobile / AR | Account warning and repository runbook path reachable | Pass | `private-uat.spec.ts`, shell unit tests |
| Supabase Auth/RLS | Private UAT | Real token, expiry, authorization, user isolation | **Blocked** | No environment contact authorized |
| PostgreSQL persistence | Private UAT | Process/service restart and immutable database history | **Blocked** | In-memory fixture is not database proof |
| Private artifact/device | Desktop + mobile / EN/AR | Exact build over private HTTPS; tailnet loss/recovery | **Blocked** | No deployment or remote host contact authorized |
| Backup/restore | Private UAT | Encrypted off-site point, scratch restore, RPO/RTO | **Blocked** | Repository fixtures only |

Final verification counts and the exact tested head are appended after the final
green run in the same branch.

Ready for private live authenticated UAT: **No**.
