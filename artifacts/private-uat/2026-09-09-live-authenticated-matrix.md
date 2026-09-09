# Budget development-stack authenticated integration UAT attempt

Run time: 2026-09-09 20:13-20:41 EEST

Run tag: `909c40535809`

Application source: detached `80d0432334e26f8bdb74184930a6677f8b5dc3e9`

Branch/publish state: no branch; local and unpushed

## Release-candidate integration note

This note records integration after the attempt; it does not rewrite any result
below. The reviewed correction-label fix from source
`8d5d1661f1cd6ec303a88615b24b994d7b0c25b9` is integrated in this release
candidate as `0d849194a51ec7c4ae30854e7d9654ad45b50393`. It distinguishes loan
openings from borrowing repayments in the correction action's accessible name.
The evidence-only sources `abb8bf18ac8581dc7e3ec83784a1871d31abcdff` and
`0bc87416087aa5adce3f0de98a8584f586a71572` are integrated as
`0253c955d6ba3c6101e1d31fdb8a52dfa479b4e8` and
`9239f0ec0f9038af8aff8e45c5f658bb2c4928e9`, respectively.

Formal authenticated UAT against an isolated exact 18-migration schema has not
been rerun. The historical Fail/Blocked observations and remaining private-UAT
gates below therefore remain unchanged.

## Safety and environment identity

Formal private live UAT was **not executed**: this run used local Vite and the
shared Budget development backend, not an isolated UAT stack, exact release
artifact, or approved private HTTPS origin. The evidence below is an
authenticated integration attempt that narrows the remaining blockers; it must
not be reused as private-UAT acceptance.

Only synthetic identities, names, and minor-unit amounts were used. No Sandooq,
POS, hosted Supabase, production database, provider, email, public deployment,
or real financial data was contacted.

The ignored `.env.local` in the ordinary checkout points at a hosted Supabase
project and was rejected before the app started. The browser app instead used a
transient, non-printed anon key read directly from the already verified Budget
development stack. The key was held only in process memory, all browser/API
sessions were signed out, the browser was closed, and the JavaScript kernel was
reset after the run.

| Identity check | Observed result | Status |
|---|---|---|
| Approved SSH target | `lelabo@100.76.160.91`; remote hostname `lelabo`; exact Tailscale IPv4 matched | Pass |
| Budget marker and project | `/home/lelabo/budget-supabase/.budget-project`; `project_id = "budget-supabase"` | Pass |
| Network boundary | `budget-tailnet-firewall.service` active and enabled | Pass |
| Container scope | Every inspected container carried project label `budget-supabase`; restart policy `no` | Pass |
| PostgreSQL identity | database `postgres`; server `170006`; system identifier `7683090997378195493` | Pass |
| Reviewed migration prefix | All 18 versions through `20260908103000` present; 18/18 local, manifest, and remote SHA-256 values matched | Pass |
| Exact reviewed backend pairing | Remote development journal has 31 versions through `20260908180000`, including 13 later Budget-only household migrations | **Blocked** for an exact 18-migration release pairing |
| Post-run stability | 12 Budget containers running; all reported restart count 0; all health-enabled containers healthy; identity and 31-version journal unchanged | Pass |

No migration was applied, reapplied, rolled back, copied, or edited.

## Database authorization boundary

| Check | Evidence | Status |
|---|---|---|
| RLS | Enabled on all 11 scoped tables: spaces, memberships, wallets, financial history, loans, targets, Categories, category requests, and event associations | Pass |
| Direct writes | `anon`, `authenticated`, and `service_role` had no INSERT/UPDATE/DELETE/TRUNCATE on the 10 directly writable scoped tables queried | Pass |
| Real anonymous command | Anonymous `create_space` returned SQLSTATE `42501` and created no space | Pass |
| Real tenant isolation | A second real Auth user listed zero first-user spaces; `create_wallet` against the first user's space returned `42501` | Pass |
| Categories/reversal RPC ACL | `anon` and `service_role` lacked EXECUTE; `authenticated` had EXECUTE | Pass |
| Older core RPC ACL on this environment | `create_space`, `create_wallet`, and four Loan commands including monthly target exposed EXECUTE to `anon` and `service_role`; bodies still rejected missing membership/authentication | **Environment finding**: least privilege Fail; candidate attribution **Blocked** until exact-schema replay |

The complete 59-test real-Postgres suite passed after this preflight. It includes
anonymous read rejection, category command rejection, direct-write ratchets,
and simulated privilege-drift defenses.

## Browser acceptance matrix

Browser coverage used installed Google Chrome. Desktop used a `1440x1000`
viewport. Mobile was browser emulation at `390x844`, DPR 2, with touch enabled;
it is not physical-device proof. The PNGs are full-page captures, so their
pixel dimensions exceed the viewport height.

| Area | Scenario | Result |
|---|---|---|
| Auth shell | Signed-out financial privacy; real rejected password; preserved email; successful retry | Pass |
| Auth shell | Real signup session issuance and explicit token refresh | Pass |
| Onboarding | Real personal-space and first-wallet creation | Pass |
| Wallets | New-wallet creation; opening balance; income; expense; same-currency transfer | Pass |
| Wallets | Linked reversal of a general income event | Pass |
| Categories | Bilingual expense-category creation; categorized expense; archive | Pass |
| Categories | Archived bilingual label and Archived marker after reload, app-service restart, and fresh Chrome login | Pass |
| Loans | Opening outstanding, cash lending, repayment, and monthly target | Pass |
| Loans | Reversal of an opening with a later repayment rejected with recovery guidance | Pass |
| Loans accessibility | The `loan_repay_borrowing` and `loan_opening` rows both exposed `Correct opening entry from Sep 9, 2026` | **Fail**; scoped DOM evidence below |
| Persistence | Browser reload retained PostgreSQL state | Pass |
| Recovery | Local Vite stop produced a bounded connection failure; restart restored the existing real session and PostgreSQL state | Pass |
| Client restart | Complete Chrome process restart plus fresh real sign-in restored the same ledger | Pass |
| Desktop EN | Full scoped financial path and archived-category history | Pass |
| Mobile AR/RTL | Second-user empty history, Arabic onboarding, RTL, and no horizontal overflow | Pass, emulated device |
| Mobile AR/RTL | Primary-user balances and archived Arabic history after re-login | Pass, emulated device |
| Auth expiry recovery | Token issuance/refresh passed, but an actual expired browser session was not exercised live | **Blocked** |
| Wallet rejection/ambiguity recovery | Empty and normal flows plus cross-tenant protected rejection passed; transport ambiguity/retry was not exercised live | **Blocked** |
| Category rejection/ambiguity recovery | Normal create/post/archive passed; duplicate, transport ambiguity, load failure, and retry were not exercised live | **Blocked** |
| Loan transport recovery | Empty, normal, and dependent-repayment rejection passed; transport failure/retry was not exercised live | **Blocked** |
| Private HTTPS | Exact release artifact was not deployed to an allowlisted HTTPS origin | **Blocked** |
| Physical device | No approved physical phone/tablet was available in this session | **Blocked** |
| Ubuntu service restart | Shared Budget development services were deliberately not restarted | **Blocked**; unsafe without coordination |
| Backup/restore | No encrypted off-site backup receipt or scratch restore was performed | **Blocked** |

Authenticated RLS readback for the primary synthetic space found nine immutable
events covering opening, income, expense, transfer, reversal, categorized
expense, loan opening, cash lending, and repayment; two loans; one monthly
target revision; and one archived category. The secondary synthetic space had
zero financial events.

## Visual evidence

- `artifacts/private-uat/2026-09-09-live-desktop-en.png`
- `artifacts/private-uat/2026-09-09-live-mobile-ar-empty.png`
- `artifacts/private-uat/2026-09-09-live-mobile-ar-persisted.png`

The screenshots contain only synthetic names and amounts and no email address,
password, access token, anon key, database URL, or other credential.

| File | Full-page pixels | SHA-256 |
|---|---:|---|
| `2026-09-09-live-desktop-en.png` | `1440x2529` | `7fce39f75375690ae350b981eea19a14e1d5922fd5a3183377806e9711adc758` |
| `2026-09-09-live-mobile-ar-empty.png` | `780x2230` | `e001e2ef9861a0231b4bef9be14347b428e2b7cdf339a8ce66927c07480ddd03` |
| `2026-09-09-live-mobile-ar-persisted.png` | `780x6388` | `77ec0f84c1ed06b01714b7ab6cf99c12c2f5ae7cb93cd8b8c901de890f824a31` |

## Sanitized machine receipts

Credential-bearing command output was never written. These are the exact
non-sensitive result tuples retained from bounded checks:

```text
SOURCE|80d0432334e26f8bdb74184930a6677f8b5dc3e9|detached
REMOTE|lelabo|100.76.160.91|budget-supabase|firewall=active,enabled
POSTGRES|7683090997378195493|170006|postgres
MIGRATION_PREFIX|18|20260907100000|20260908103000|hash_mismatches=0
MIGRATIONS_CURRENT|31|20260907100000|20260908180000
RLS_SCOPED|11|enabled=11
DIRECT_WRITE_SCOPED|roles=anon,authenticated,service_role|writable=0/30
REAL_AUTH|signup_session=yes|password_rejection=yes|retry=yes|refresh=yes
TENANT_ISOLATION|second_user_visible_primary_spaces=0|cross_tenant_create_wallet=42501
ANON_BOUNDARY|create_space=42501
UAT_READBACK|spaces=2|memberships=2|wallets=3|events=9|loans=2|targets=1|archived_categories=1
UAT_READBACK|secondary_events=0
CONTAINERS_AFTER|budget=12|running=12|restart_count_nonzero=0|health_failures=0
```

Build-output hashes from the verified run:

```text
aa0ec7f002c01d5bb0d428d327bbd704fbba1a1764af0ebc93757459fdb7440e  dist/index.html
4eba3e3a116ad6ebc37ef35bb45c000ed83d2990ad235aff9b5d35ae87e704d3  dist/assets/index-BoxGXpGv.css
df6b0f7f083aefca0afc5846dcd5e7d1afdd32d39bf10bb3b97ef680f807b453  dist/assets/dialog-shell-CMZSQLEg.js
9d771676c8cbc9ce1ee44251c1164d734cd05acc1e63dab3a2fb76d1a14a0a48  dist/assets/categories-page-CmuvPxE-.js
17ebdd1ac2b8fca807d6550a1a3a965060d7933f674432d57e837a56b3b847c4  dist/assets/wallets-page-CeYjOLJM.js
f519e7b235a6fde6c3e5089dbf4d974a3415b27a9be6f23c822afc74a80b4f1b  dist/assets/index-DTX77Y34.js
```

The repayment accessible-name failure was observed before submitting its
correction, in the real Loan detail DOM:

```text
visible row kind: loan repay borrowing
accessible name: Correct opening entry from Sep 9, 2026
visible row kind: loan opening
accessible name: Correct opening entry from Sep 9, 2026
Playwright strict result: 2 matching buttons for /^Correct opening entry/
```

The reviewed source explains the result at `src/features/loans/loan-dialogs.tsx`:
`historyLabel` recognizes `item.kind.includes('repayment')`, but
`loan_repay_borrowing` contains `repay`, not `repayment`, and therefore falls
through to the `opening entry` label.

## Repository verification

| Command/gate | Result |
|---|---|
| `pnpm install --offline --frozen-lockfile` | Pass; 180 packages reused, 0 downloaded |
| `pnpm check:uat:scope` | Pass from `d4bf9d2c39063eb52782188a2f860d3099994361` to exact HEAD |
| static ops check | Pass; baseline 151-file and final 152-file secret scans; ShellCheck unavailable |
| `pnpm check` | Pass: 152 ops tests, 59 database tests, 271 UI tests, typecheck, and production build |
| `CI=1 pnpm test:e2e` | Pass: 36 Chrome scenarios; 34 intentional device-project skips |

## Non-sensitive reproduction outline

1. Check out exact commit `80d0432334e26f8bdb74184930a6677f8b5dc3e9`
   in an isolated worktree and run the repository gates above.
2. Read-only verify the approved SSH host, Budget marker, project label,
   firewall, container restart policies, PostgreSQL identity, migration journal,
   reviewed migration hashes, RLS, table grants, and function grants.
3. Start local Vite at `127.0.0.1` with the approved Budget development URL and
   a transient anon key supplied through the process environment. Never print or
   write the key. Refuse any hosted, production, or non-Budget endpoint.
4. Create two disposable `.test`/`example.test` identities through real Supabase
   Auth. Use the first for the scoped financial flow and the second for empty-state
   and tenant-isolation checks.
5. Perform every financial change through the application UI or the approved
   protected RPC. Use only synthetic money. Verify cross-tenant rejection before
   adding the second user's own space.
6. Reload, stop and restart only local Vite, then restart Chrome and sign in
   again. Read the same immutable state through authenticated RLS.
7. Sign out all sessions, close Chrome, clear credential-bearing process memory,
   stop local Vite, and repeat the read-only remote identity/health check.

## Cleanup and verdict

The observed browser session was signed out through the UI; both programmatic
Supabase clients returned successful `signOut` results; Chrome and Vite were
stopped; and credential-bearing process memory was reset. No separate
server-side refresh-token inventory was inspected. The two synthetic Auth
users, two synthetic spaces, three wallets, nine financial events, two loans,
one monthly-target revision, and one archived category were retained in the
dedicated Budget development database. Deleting them is not safely supported by
the reviewed UI/RPC contract: memberships and immutable history use restrictive
foreign keys and append-only guards. No direct database deletion was attempted.

Budget development-stack authenticated integration attempt: **Fail/Blocked**.
Formal private live UAT: **Not executed**. Real Auth, RLS, PostgreSQL
persistence, and the minimum financial path passed, but the repayment correction
accessible name fails, the environment's older core RPC ACLs are not
least-privilege and cannot be attributed to the candidate without exact-schema
replay, live error/recovery coverage is incomplete, the database is a
31-migration forward superset rather than the exact reviewed 18-migration
pairing, and private HTTPS/physical-device proof remains blocked.

Ready for encrypted off-site backup and scratch-restore gate: **No**. Resolve or
explicitly accept the accessibility failure, reproduce and resolve or accept the
ACL environment finding against an exact-schema database, complete live
error/recovery coverage, and provide an isolated exact-schema UAT origin with
private HTTPS before advancing the release candidate.
