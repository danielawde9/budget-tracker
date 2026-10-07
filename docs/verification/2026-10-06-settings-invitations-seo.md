# Settings invitations, desktop branding and SEO — 2026-10-06

## Why Invite was missing

The October v2 cut intentionally left household invitations out (see the connected-money-model spec and `docs/decisions.md`). Settings did not render a membership section, the typed v2 API exposed no invitation calls, and the v2 schema had membership but no invitation table. This was not a permissions or CSS visibility failure.

## Invitation behavior

Settings now shows **Invite a member**. Owners enter an email and create a link to copy and send themselves. Members see an explanation that only owners can invite. No email is sent by the app.

Links expire in seven days, are bound to the invited confirmed email, and can be revoked. A new link for an email revokes its previous pending links. Owners can have at most 20 outstanding invitations in a space. The client uses 32 cryptographically random bytes; the database stores only a SHA-256 digest. A lost response retries with the same token and request ID. Anonymous roles cannot invoke the invitation functions or read the private table; RLS remains enabled as a second layer.

Recipients sign in or create an account, confirm the invited email, reopen the link if needed, and explicitly accept. The acceptance screen works before onboarding for accounts without a space. Joining selects the shared space and refreshes the space list. Member access includes viewing and updating the financial plan, accounts and activity; the UI explains this before inviting and accepting.

## Desktop refinement

The 220px sidebar uses a 14px brand name and an 18px icon, with a single unbroken line. The desktop sign-in brand uses 16px. Invite fields fill their existing 440px form column. The established colors, layout and bilingual behavior remain.

## SEO coverage

- Static public title and factual description, visible pre-React entry content and a no-JavaScript explanation.
- Canonical URL, Open Graph and Twitter summary previews with an existing public icon and alt text.
- WebSite and WebApplication JSON-LD, with actual supported features/languages and no invented pricing, reviews or ratings.
- English and Arabic titles/descriptions on the entry page; route titles for Home, Plan, Activity, Accounts, Settings, setup and invitation acceptance.
- Private pages and invitation screens set `noindex, nofollow`; no private financial values, space names, emails or invitation tokens enter metadata.
- A sitemap containing the one public entry URL and robots.txt referencing it. Hash-based private screens are not separate public search pages. Locale is stored locally, so alternate-language hreflang URLs would not represent distinct pages and are deliberately not invented.

The canonical address is `https://budget-tracker.danielawde9.workers.dev/`, the deployed address documented in README. `openbudgetracker.app` is the product name, not a configured domain. When a custom domain is actually configured, update index.html, PageMetadata.SITE_URL, robots.txt and sitemap.xml together.

This follows [Google's JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) and [Supabase's function authorization guidance](https://supabase.com/docs/guides/database/functions).

## Release boundary

Changes are verified locally. Apply `20261006082542_space_invitations.sql` to the target database before deploying the frontend. The migration only adds an invitation table and protected functions; it does not reset existing spaces, logins or money. Automatic email delivery would require a separate provider integration.

No production migration or frontend deployment was performed in this task.

## Validation before push — 2026-10-07

`pnpm check` passed: typechecking, 170 database tests, 125 UI tests, and the production build. The targeted owner-to-recipient browser flow passed during implementation, including English/Arabic mobile layouts and desktop brand sizing. Public metadata and built SEO assets were also checked.

The broader browser suite does not have a confirmed clean final run. Its initial run exposed an ambiguous existing “Take back” selector, now scoped to the money panel. Later browser runs failed or were interrupted, so the full end-to-end gate remains unverified and must not be represented as passing.
