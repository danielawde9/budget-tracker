# Budget Foundation Design

## Scope

This design covers only milestone 1 of Budget: the secure database foundation
and its rejection tests. It deliberately excludes authentication user flows,
offline drafts, budgeting, savings, assets, debts, reports, and deployment.

The React application will remain on Daniel's Mac. A Budget-specific Supabase
development stack will run on the Le Labo Ubuntu host and be reachable only
over Tailscale. Creating a hosted Supabase project is a separate launch action
and is outside this scope.

## Chosen approach

Budget will use a typed, append-only financial journal rather than editable
wallet balances or a general-purpose accounting chart.

Each financial command creates one immutable event and one or more signed
wallet movements. Wallet balances are projections of movements, never editable
stored totals. A correction is represented by a linked reversal and a new
replacement event; it does not update a posted event in place.

This retains traceability and permits trustworthy balances without imposing a
full accounting-chart interface on a family budget application.

## Data boundaries

- A space owns its wallets, categories, financial events, and movements.
- A profile can hold memberships in private or household spaces.
- Membership is the only authorization path to a space. Household membership
  never grants access to a member's private space.
- Wallets belong to exactly one space and one supported currency.
- Opening balances are distinct financial events and are excluded from income.
- Each event records the authenticated actor, an effective local date, and a
  server-generated UTC timestamp.
- All money values are exact integer minor units passed through commands as
  strings. USD uses cents; LBP uses whole pounds.

## Mutation and security model

The browser has no direct insert, update, or delete privileges on financial
journal tables. It can call narrowly granted database commands.

Each command accepts a request UUID, space ID, effective date, and bounded
movement payload. It runs in one transaction and checks:

- the caller is an active member of the requested space;
- every referenced wallet belongs to that same space;
- values use the wallet's currency and are non-zero;
- the requested event type has a valid movement shape;
- the request UUID has not already been applied for the space.

Commands use a fixed `search_path`, explicitly validate the caller, and have
execution revoked from `PUBLIC`. Direct table privileges remain unavailable to
anonymous and authenticated client roles.

Row-level security is enabled for every exposed space-owned table. Policies
derive visibility from indexed membership lookups. Financial mutation commands
perform their own membership checks and do not rely on a client-supplied actor.

## Initial command surface

The foundation exposes only the commands needed to prove the journal:

- create a space and its owner membership;
- create a wallet;
- record an opening balance;
- record a basic income or expense event;
- record an in-space transfer;
- reverse a posted event;
- query a wallet balance projection.

Category splits, exchanges, refunds, savings, debts, assets, and cross-space
contributions build on these primitives in later milestones. They are not
silently approximated in this foundation.

## Error handling and idempotency

Commands fail closed with stable, user-safe error codes. A failed command
rolls back all its event and movement rows. Repeating an accepted request UUID
returns the original result without creating another event. Reusing a request
UUID with different command data is rejected.

The initial schema stores enough request metadata to compare replays without
logging transaction notes or other unnecessary personal data.

## Test evidence

Database integration tests run against the isolated Ubuntu PostgreSQL instance.
They must demonstrate:

1. A member cannot read or mutate another space's records.
2. A non-member and an anonymous session are denied.
3. Invalid same-event movements and cross-space wallet references are rejected.
4. A command failure leaves no partial movement rows.
5. Replaying a request UUID produces one event and the original result.
6. Opening balances affect wallet balance but not received income.
7. A transfer changes both wallets while leaving income and spending unchanged.
8. A reversal preserves the original event and correctly updates projections.

## Decisions and release boundary

The implementation will use a Budget-only remote development stack on Ubuntu
over Tailscale. Existing Sandooq data, Docker resources, and development
configuration are out of scope and must remain untouched. No hosted project,
DNS, deployment, or email delivery action is authorized by this design.
