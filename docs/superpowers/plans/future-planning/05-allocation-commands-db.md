# 05 — Allocation commands implementation plan

> **For agentic workers:** Use executing-plans and test-driven-development.

**Goal:** Save templates and publish exact monthly plans atomically.
**Layer:** DB. **Depends on:** 03–04. **Tech Stack:** PostgreSQL/pg/Vitest.

Create `_allocation_commands.sql` with a fresh timestamp and
`tests/db/allocation-commands.integration.test.ts`; update inventory, decisions,
and `docs/verification/future-planning/05.md`. All domain tables already exist.

## Task 1 — Exact apportionment helper and test vectors

Create `private.allocate_planning_income(p_income text,p_groups jsonb)` returning
`TABLE(group_id uuid,target_minor bigint,is_residual boolean)` with this full
body. Inputs contain only `id`, `order`, `basisPoints`; domain names/purpose live
in the template, not this arithmetic helper.

```sql
create function private.allocate_planning_income(p_income text,p_groups jsonb)
returns table(group_id uuid,target_minor bigint,is_residual boolean)
language plpgsql immutable set search_path=pg_catalog as $$
declare v_income bigint; v_entry jsonb; v_id uuid; v_order integer; v_bps integer;
  v_ids uuid[] := '{}'; v_orders integer[] := '{}'; v_sum integer := 0;
begin
  v_income := private.planning_minor(p_income);
  if p_groups is null or jsonb_typeof(p_groups) is distinct from 'array'
    or octet_length(p_groups::text)>65536 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  if jsonb_array_length(p_groups)>12 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  for v_entry in select value from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_entry) is distinct from 'object' then
      raise exception using errcode='22023',message='planning_invalid_input';
    end if;
    if (v_entry ?& array['id','order','basisPoints']) is not true
      or (v_entry - array['id','order','basisPoints']) <> '{}'::jsonb
      or jsonb_typeof(v_entry->'id') is distinct from 'string'
      or jsonb_typeof(v_entry->'order') is distinct from 'number'
      or jsonb_typeof(v_entry->'basisPoints') is distinct from 'number'
      or (v_entry->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry->>'order') !~ '^(0|[1-9][0-9]?)$'
      or (v_entry->>'basisPoints') !~ '^(0|[1-9][0-9]{0,4})$' then
      raise exception using errcode='22023',message='planning_invalid_input';
    end if;
    v_id := (v_entry->>'id')::uuid;
    v_order := (v_entry->>'order')::integer;
    v_bps := (v_entry->>'basisPoints')::integer;
    if v_id='ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid or v_id=any(v_ids)
      or v_order=any(v_orders) or v_order>11 or v_bps>10000 then
      raise exception using errcode='22023',message='planning_invalid_input';
    end if;
    v_ids := array_append(v_ids,v_id); v_orders := array_append(v_orders,v_order);
    v_sum := v_sum+v_bps;
  end loop;
  if v_sum>10000 then
    raise exception using errcode='22023',message='planning_invalid_input';
  end if;
  return query
  with weights as (
    select (e->>'id')::uuid gid,(e->>'order')::integer ord,
      (e->>'basisPoints')::integer bps,false residual
    from jsonb_array_elements(p_groups) e
    union all select 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,12,10000-v_sum,true
  ), parts as (
    select *,floor(v_income::numeric*bps/10000) base,
      mod(v_income::numeric*bps,10000) fraction from weights
  ), ranked as (
    select *,row_number() over(order by fraction desc,ord,gid) rnk,
      v_income::numeric-sum(base) over() extra from parts
  )
  select gid,(base+case when rnk<=extra then 1 else 0 end)::bigint,residual
  from ranked order by ord,gid;
end; $$;
revoke all on function private.allocate_planning_income(text,jsonb)
  from public,anon,authenticated,service_role;
```

Tests as fixture admin for the private helper: 200000 at 5600/2400/2000 →
112000/48000/40000/residual0; 101 →57/24/20/0; 1 at 5000/3000/2000 →1/0/0/0;
100 with only 5600 →56/residual44; zero income/all-zero weights; maximum amount;
duplicate IDs/order; invalid UUID; JSON null; string bps; fractional bps; >10000.
Add the same bounded 0…1000 conservation sweep used in the earlier TS example.

## Task 2 — Save-template public contract

Exact signature:

```text
public.save_allocation_template(
  p_space_id uuid, p_request_id uuid, p_currency public.currency_code,
  p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb
) RETURNS jsonb
```

Group object exact fields: `id` UUID, `purpose` spending/future, `nameEn` nullable
string, `nameAr` nullable string, `order` integer0…11, `basisPoints` integer0…10000.
Root mapping: `categoryId` UUID, `groupId` UUID. Names trim, empty→null; require
at least one, ≤80 characters. Arrays max 12/max 200; duplicates/unknown fields
are rejected. New group IDs are supplied UUIDs; existing group IDs must have
identical space/currency/purpose. No implicit change of purpose.

Implement the transaction in exactly this order:

1. Validate required inputs and bounded shapes; normalize all values; call the
   allocation helper with income0 to prove weights; sort root mappings by UUID.
2. `v_actor := private.lock_planning_actor(p_space_id)`; fingerprint canonical
   command/payload including expected revision; call `planning_replay`; return
   immediately on identical receipt.
3. Read latest template id for space/currency `ORDER BY id DESC LIMIT 1`;
   compare to expected with `IS DISTINCT FROM`, raise `40001` on difference.
4. Lock referenced category rows in UUID order `FOR SHARE`. Require same-space
   active expense roots. Each mapping points to an included spending group.
5. Insert only previously unseen valid group identities; verify conflicts rather
   than `ON CONFLICT DO NOTHING` hiding a foreign identity.
6. Insert template header with declared counts and expected head; insert all
   group and root lines. Common deferred checks must pass.
7. Insert receipt result `{"templateRevisionId":"<bigint>"}` with the actual ID;
   return that result. No default category creation and no financial posting.

## Task 3 — Publish-month public contract

```text
public.publish_allocation_month(
  p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code,
  p_expected_snapshot_id bigint, p_template_revision_id bigint,
  p_expected_income_revision_id bigint, p_income_minor text,
  p_root_targets jsonb, p_loan_group_id uuid
) RETURNS jsonb
```

`p_root_targets` objects: `categoryId` UUID, `amountMinor` canonical text,
`expectedRevisionId` bigint-text or null. **Complete-set publication:** include
all roots mapped by the template plus all existing positive manual targets for
this month/currency. To stop an old positive target, include it explicitly with
zero; omission is a rejection. Cap200. Include zero mapped roots too. Do not
use per-root group input: group comes from the chosen template; unmapped manual
roots are standalone. Archived roots accept zero only under the existing rule.

`p_loan_group_id` null means standalone loan pool; otherwise it must be an
included Future group. Snapshot loan row is always present, including zero,
so `loan_line_count=1`. Current debt amounts come from the protected per-currency
loan projection; they are not client inputs.

Transaction recipe:

1. Validate shapes/month, parse money/IDs, normalize root order.
2. Lock actor/space → canonical fingerprint → replay. Then compare current
   snapshot and income heads. The specified template need not be latest, but
   must belong to this space/currency and the caller deliberately selected it;
   UI displays “Using template revision …” if stale.
3. Compare every root head; verify complete-set rule and current lifecycle;
   compute apportionment; sum child targets in each spending group and require
   sum≤parent target. Read loan commitment; require it fits selected Future
   group, or report overallocated if standalone. A standalone deficit may be
   saved with explicit UI review; parent-child inconsistency cannot.
4. Call `set_monthly_income_plan` once and `set_monthly_category_target` in UUID
   order, with expected heads. Derive child request UUIDs server-side as below.
   Use returned revision IDs; never look up “latest” afterward as a substitute.
5. Insert snapshot header, copied group lines, root lines with exact returned
   IDs/amounts, and observed loan pool. Strengthen task 04 deferred check to
   compare exact helper outputs, not just their sum.
6. Insert receipt and return
   `{"snapshotId":"...","incomeRevisionId":"..."}`. Force rollback if any
   child fails; do not catch-and-continue inside this command.

Deterministic child requests: private helper accepts parent UUID and operation
text (≤120 chars), computes SHA-256 over canonical JSON `[parent,operation]`,
takes the first16 bytes, sets UUID version/variant bits, casts its formatted
hex to UUID. Operation strings are `income:<currency>:<month>` and
`category:<rootUuid>:<currency>:<month>`. Use the exact task 03 helper and verify its golden vector. Verify SQL/TS
reproduction if any client ever uses it. Child requests live in the existing monthly revision namespace;
receipt conflicts with unrelated prior UUIDs reject atomically.

## Task 4 — Test race/rollback/security, then commit

Add real DB tests for template/publish happy paths and every rejection above.
Use `orderedAuthenticatedRace` for two publishes from the same head: first
commits, second returns stale, exactly one successor. Repeat with a direct old
category setter versus publication. Race archive/removal against publish;
membership result follows the common space-lock order. Insert bad last child
to prove income/earlier targets/receipt roll back together. Remove membership
before replay and lookup; both deny. Same actor/payload replay after later
revisions returns its original receipt, never creates another revision.

Run env-loaded focused file, empty/seeded upgrade checks and full `pnpm check`.
Record grants and unchanged financial digests; commit
`feat(planning): publish monthly allocations atomically`. Exit before reads/UI.

## Child request helper

Use `private.planning_child_request` defined in task 03. Its full implementation
and golden-vector contract are in that prerequisite; never reimplement a different
encoding in a domain command.
