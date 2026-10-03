#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly LIVE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly LIVE_REPO_ROOT="$(cd "${LIVE_SCRIPT_DIR}/../.." && pwd -P)"
# shellcheck source=./budget-common.sh
source "${LIVE_SCRIPT_DIR}/budget-common.sh"

readonly LIVE_PROJECT_REF='dfuxxzlhmxscgvxdmwti'
readonly LIVE_MANIFEST_SOURCE_SHA='2e278cb6258af1561652847c22ef28aced80e9cc'
readonly LIVE_CONFIRMATION="APPLY LIVE MIGRATIONS TO ${LIVE_PROJECT_REF}"
readonly LIVE_MAX_PROJECT_LIST_BYTES=1048576
readonly LIVE_SUPABASE_BIN="${BUDGET_SUPABASE_BIN:-$(command -v supabase || true)}"
readonly LIVE_NODE_BIN="$(command -v node || true)"
readonly LIVE_BACKUP_REQUESTED="${BUDGET_LIVE_BACKUP_ROOT:-${LIVE_REPO_ROOT}/.supabase/pre-migration-backups}"
readonly LIVE_VERIFY_SQL="select case when
  to_regclass('public.spaces') is not null
  and to_regclass('public.space_memberships') is not null
  and to_regclass('public.wallets') is not null
  and to_regclass('public.financial_events') is not null
  and to_regclass('public.loans') is not null
  and to_regclass('public.categories') is not null
  and to_regclass('public.household_invitations') is not null
  and to_regprocedure('public.create_subcategory(uuid,uuid,uuid,text,text)') is not null
  and to_regprocedure('public.archive_wallet(uuid,uuid,uuid)') is not null
  and to_regclass('public.monthly_budget_plan_revisions') is not null
  and to_regclass('public.planning_command_receipts') is not null
  and to_regclass('public.allocation_month_snapshots') is not null
  and to_regprocedure('public.publish_allocation_month(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid)') is not null
  and to_regprocedure('public.allocation_month_state(uuid,date,public.currency_code,bigint)') is not null
  and to_regclass('public.goals') is not null
  and to_regprocedure('public.consume_household_invitation_delivery_limit(uuid)') is not null
  and has_function_privilege('authenticated','public.consume_household_invitation_delivery_limit(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.consume_household_invitation_delivery_limit(uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.consume_household_invitation_delivery_limit(uuid)','EXECUTE')
  and to_regclass('private.household_invitation_delivery_limits') is not null
  and not has_table_privilege('authenticated','private.household_invitation_delivery_limits','SELECT')
  and has_schema_privilege('household_command_owner','extensions','USAGE')
  and to_regprocedure('public.set_goal_state(uuid,uuid,uuid,bigint,text)') is not null
  and has_function_privilege('authenticated','public.set_goal_state(uuid,uuid,uuid,bigint,text)','EXECUTE')
  and not has_function_privilege('anon','public.set_goal_state(uuid,uuid,uuid,bigint,text)','EXECUTE')
  and not has_function_privilege('service_role','public.set_goal_state(uuid,uuid,uuid,bigint,text)','EXECUTE')
  and to_regclass('public.goal_earmark_events') is not null
  and to_regclass('public.goal_purchase_links') is not null
  and to_regprocedure('public.create_goal_plan(uuid,uuid,uuid,jsonb,jsonb)') is not null
  and to_regprocedure('public.record_goal_earmark(uuid,uuid,uuid,text,text,text,boolean)') is not null
  and to_regprocedure('public.link_goal_purchase(uuid,uuid,uuid,jsonb)') is not null
  and to_regclass('public.allocation_month_goal_lines') is not null
  and to_regprocedure('public.goal_page(uuid,public.currency_code,text,timestamptz,uuid,integer)') is not null
  and to_regprocedure('public.goal_detail(uuid,uuid,date)') is not null
  and to_regprocedure('public.publish_allocation_month_v2(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid,jsonb)') is not null
  and to_regclass('public.schedules') is not null
  and to_regclass('public.scheduled_occurrences') is not null
  and to_regprocedure('public.save_schedule(uuid,uuid,uuid,bigint,jsonb)') is not null
  and to_regprocedure('public.confirm_scheduled_occurrence(uuid,uuid,uuid,bigint,text,date,uuid)') is not null
  and to_regprocedure('public.scheduled_occurrence_page(uuid,date,date,date,uuid,integer)') is not null
  and to_regprocedure('public.available_cash_summary(uuid,public.currency_code,date)') is not null
  and to_regprocedure('public.cash_outlook(uuid,public.currency_code,date,integer,text)') is not null
  and to_regclass('public.budget_month_closes') is not null
  and to_regclass('public.budget_month_carry_links') is not null
  and to_regprocedure('public.close_budget_month(uuid,uuid,public.currency_code,date,bigint,text)') is not null
  and to_regprocedure('public.copy_allocation_month(uuid,uuid,public.currency_code,bigint,date,bigint,text)') is not null
  and to_regprocedure('public.set_rollover_policy(uuid,uuid,public.currency_code,uuid,boolean,bigint)') is not null
  and to_regprocedure('public.journal_search_page(uuid,date,date,uuid,uuid,uuid,bigint,bigint,text,text,integer)') is not null
  and exists (select 1 from pg_trigger where tgname = 'financial_events_reversal_date_guard' and tgenabled in ('O', 'A'))
  and to_regprocedure('public.allocation_template_head(uuid,public.currency_code)') is not null
  and to_regprocedure('public.monthly_budget_category_page_v3(uuid,date,public.currency_code,text,uuid,integer)') is not null
  and to_regprocedure('public.scheduled_overdue_page(uuid,date,uuid,integer)') is not null
  and to_regprocedure('public.unlink_scheduled_payment(uuid,uuid,uuid,bigint,text)') is not null
  and to_regprocedure('public.confirm_scheduled_occurrence_v2(uuid,uuid,uuid,text,text,date,uuid)') is not null
  and to_regprocedure('public.link_scheduled_payment_v2(uuid,uuid,uuid,uuid,text,text)') is not null
  and to_regprocedure('public.set_occurrence_state_v2(uuid,uuid,uuid,text,text)') is not null
  and to_regclass('public.scheduled_payment_unlinks') is not null
  and to_regclass('public.scheduled_payment_goal_links') is not null
  and to_regclass('public.goal_purchase_unlinks') is not null
  and to_regclass('public.space_schedule_revisions') is not null
  and to_regclass('public.space_period_definitions') is not null
  and to_regprocedure('public.space_period_context(uuid,date)') is not null
  and to_regprocedure('public.loan_period_balances(uuid,date)') is not null
  and to_regprocedure('public.goal_period_target_page(uuid,date,public.currency_code,uuid,integer)') is not null
  and to_regprocedure('private.ensure_space_period_definition(uuid,date)') is not null
  and to_regprocedure('public.set_space_schedule(uuid,uuid,text,integer,bigint)') is not null
  and to_regprocedure('public.allocation_template_defaults(uuid,public.currency_code)') is not null
  and has_function_privilege('authenticated','public.allocation_template_defaults(uuid,public.currency_code)','EXECUTE')
  and not has_function_privilege('anon','public.allocation_template_defaults(uuid,public.currency_code)','EXECUTE')
  and not has_function_privilege('service_role','public.allocation_template_defaults(uuid,public.currency_code)','EXECUTE')
  and exists (select 1 from pg_proc where oid=to_regprocedure('public.allocation_template_defaults(uuid,public.currency_code)') and provolatile='s')
  and to_regprocedure('public.preview_default_period_plan(uuid,date,public.currency_code)') is not null
  and to_regprocedure('public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb)') is not null
  and has_function_privilege('authenticated','public.preview_default_period_plan(uuid,date,public.currency_code)','EXECUTE')
  and has_function_privilege('authenticated','public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.preview_default_period_plan(uuid,date,public.currency_code)','EXECUTE')
  and not has_function_privilege('service_role','public.preview_default_period_plan(uuid,date,public.currency_code)','EXECUTE')
  and not has_function_privilege('anon','public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.initialize_period_plan(uuid,uuid,date,public.currency_code,text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','private.resolve_default_plan_reference(jsonb,jsonb,boolean)','EXECUTE')
  and exists (select 1 from pg_proc where oid=to_regprocedure('public.preview_default_period_plan(uuid,date,public.currency_code)') and provolatile='s')
  and to_regprocedure('public.purchase_goal(uuid,uuid,jsonb)') is not null
  and has_function_privilege('authenticated','public.purchase_goal(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.purchase_goal(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.purchase_goal(uuid,uuid,jsonb)','EXECUTE')
  and to_regprocedure('public.record_and_settle(uuid,uuid,jsonb)') is not null
  and has_function_privilege('authenticated','public.record_and_settle(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.record_and_settle(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.record_and_settle(uuid,uuid,jsonb)','EXECUTE')
  and to_regprocedure('public.record_settlement_context(uuid,uuid)') is not null
  and has_function_privilege('authenticated','public.record_settlement_context(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.record_settlement_context(uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.record_settlement_context(uuid,uuid)','EXECUTE')
  and exists (select 1 from pg_proc where oid=to_regprocedure('public.record_settlement_context(uuid,uuid)') and provolatile='s')
  and to_regprocedure('public.save_period_plan(uuid,uuid,date,public.currency_code,jsonb)') is not null
  and to_regprocedure('public.period_plan_legacy_review(uuid,date,public.currency_code)') is not null
  and to_regprocedure('public.approved_budget_summary(uuid,date,public.currency_code)') is not null
  and to_regprocedure('public.approved_category_budget_page(uuid,date,public.currency_code,uuid,integer)') is not null
  and to_regprocedure('public.approved_loan_monthly_plan(uuid,date)') is not null
  and to_regprocedure('public.approved_loan_monthly_currency_summary(uuid,date)') is not null
  and to_regclass('private.period_plan_save_evidence') is not null
  and exists (select 1 from pg_class where oid=to_regclass('private.period_plan_save_evidence') and relrowsecurity)
  and not has_table_privilege('authenticated','private.period_plan_save_evidence','SELECT,INSERT,UPDATE,DELETE')
  and not has_function_privilege('authenticated','private.publish_period_plan(uuid,uuid,date,public.currency_code,bigint,bigint,bigint,text,jsonb,uuid,jsonb,boolean,jsonb)','EXECUTE')
  and exists (select 1 from pg_trigger where tgname='period_plan_save_evidence_valid' and tgenabled in ('O','A') and tgdeferrable and tginitdeferred)
  and to_regprocedure('public.period_plan_page(uuid,date,public.currency_code)') is not null
  and to_regclass('public.period_plan_loan_sets') is not null
  and to_regclass('public.period_plan_loan_lines') is not null
  and to_regclass('private.loan_target_acceptance_order') is not null
  and to_regprocedure('public.save_allocation_group_roles(uuid,uuid,public.currency_code,bigint,uuid,uuid)') is not null
  and to_regprocedure('public.set_goal_default_group(uuid,uuid,uuid,uuid,bigint)') is not null
  and to_regprocedure('public.goal_period_target_defaults_page(uuid,date,public.currency_code,uuid,integer)') is not null
  and to_regprocedure('private.resolve_goal_plan_group(uuid,public.currency_code,uuid,uuid)') is not null
  and to_regprocedure('private.resolve_debt_plan_group(uuid,public.currency_code,uuid)') is not null
  and to_regclass('public.allocation_group_role_revisions') is not null
  and to_regclass('public.goal_default_group_revisions') is not null
  and to_regprocedure('private.current_loan_period_targets(uuid,date)') is not null
  and to_regprocedure('public.space_clock(uuid)') is not null
  and to_regprocedure('public.space_today(uuid)') is not null
  and to_regprocedure('public.space_period_bounds(uuid,date)') is not null
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'spaces' and column_name = 'payday_day')
  and exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'check_goal_earmark_event' and p.prosrc like '%goal_financing_state%')
  and to_regprocedure('public.wallet_balance_as_of(uuid,uuid,date)') is not null
  and has_function_privilege('authenticated','public.wallet_balance_as_of(uuid,uuid,date)','EXECUTE')
  and not has_function_privilege('anon','public.wallet_balance_as_of(uuid,uuid,date)','EXECUTE')
  and not has_function_privilege('service_role','public.wallet_balance_as_of(uuid,uuid,date)','EXECUTE')
  and to_regprocedure('private.save_period_plan_with_carry(uuid,uuid,date,public.currency_code,jsonb,jsonb)') is not null
  and not has_function_privilege('authenticated','private.save_period_plan_with_carry(uuid,uuid,date,public.currency_code,jsonb,jsonb)','EXECUTE')
  and to_regprocedure('public.daily_control_summary(uuid,date,public.currency_code)') is not null
  and has_function_privilege('authenticated','public.daily_control_summary(uuid,date,public.currency_code)','EXECUTE')
  and not has_function_privilege('anon','public.daily_control_summary(uuid,date,public.currency_code)','EXECUTE')
  and not has_function_privilege('service_role','public.daily_control_summary(uuid,date,public.currency_code)','EXECUTE')
  and to_regprocedure('public.daily_control_obligations(uuid,date,public.currency_code,integer)') is not null
  and has_function_privilege('authenticated','public.daily_control_obligations(uuid,date,public.currency_code,integer)','EXECUTE')
  and not has_function_privilege('anon','public.daily_control_obligations(uuid,date,public.currency_code,integer)','EXECUTE')
  and not has_function_privilege('service_role','public.daily_control_obligations(uuid,date,public.currency_code,integer)','EXECUTE')
  and to_regprocedure('private.daily_cash_commitments(uuid,public.currency_code,date,date)') is not null
  and not has_function_privilege('authenticated','private.daily_cash_commitments(uuid,public.currency_code,date,date)','EXECUTE')
  and to_regprocedure('private.daily_expense_buckets(uuid,public.currency_code,date,date,date,date)') is not null
  and not has_function_privilege('authenticated','private.daily_expense_buckets(uuid,public.currency_code,date,date,date,date)','EXECUTE')
  and to_regclass('public.workspace_setup_receipts') is not null
  and exists (select 1 from pg_class where oid=to_regclass('public.workspace_setup_receipts') and relrowsecurity)
  and not has_table_privilege('anon','public.workspace_setup_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated','public.workspace_setup_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role','public.workspace_setup_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and to_regprocedure('public.create_onboarding_space(uuid,text,public.space_kind,text,integer)') is not null
  and has_function_privilege('authenticated','public.create_onboarding_space(uuid,text,public.space_kind,text,integer)','EXECUTE')
  and not has_function_privilege('anon','public.create_onboarding_space(uuid,text,public.space_kind,text,integer)','EXECUTE')
  and not has_function_privilege('service_role','public.create_onboarding_space(uuid,text,public.space_kind,text,integer)','EXECUTE')
  and to_regprocedure('public.create_onboarding_wallet(uuid,uuid,text,public.currency_code)') is not null
  and has_function_privilege('authenticated','public.create_onboarding_wallet(uuid,uuid,text,public.currency_code)','EXECUTE')
  and not has_function_privilege('anon','public.create_onboarding_wallet(uuid,uuid,text,public.currency_code)','EXECUTE')
  and not has_function_privilege('service_role','public.create_onboarding_wallet(uuid,uuid,text,public.currency_code)','EXECUTE')
  and to_regprocedure('public.find_workspace_setup_receipt(uuid,uuid)') is not null
  and has_function_privilege('authenticated','public.find_workspace_setup_receipt(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.find_workspace_setup_receipt(uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.find_workspace_setup_receipt(uuid,uuid)','EXECUTE')
  and (select array_agg(version order by version) from supabase_migrations.schema_migrations)
    = array[
      '20260929140000','20260929140050','20260929140100','20260929140200','20260929140300','20260929140400','20260929140500','20260929140600','20260929140700','20260930100000','20260930100100','20260930100200','20260930100300','20260930100400','20260930100500','20260930100550','20260930100600','20260930100700','20260930100800','20260930100900','20260930101000','20260930101100','20261002170000','20261002171000','20261003120000','20261003121000'
    ]::text[]
  then 'budget_schema_ready'
  else 'budget_schema_incomplete'
end as result;"

live_fail() {
  budget_error "$1" 78
  exit 78
}

live_cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
  if [[ -n "${LIVE_TEMP_DIR:-}" && -d "${LIVE_TEMP_DIR}" && \
    ! -L "${LIVE_TEMP_DIR}" ]]; then
    rm -f -- "${LIVE_TEMP_DIR}/empty-applied.txt" "${LIVE_TEMP_DIR}/projects.json"
    rmdir -- "${LIVE_TEMP_DIR}" 2>/dev/null || true
  fi
  if [[ -n "${live_lock_dir:-}" && -d "${live_lock_dir}" ]]; then
    rmdir -- "${live_lock_dir}" 2>/dev/null || true
  fi
  exit "${status}"
}

trap live_cleanup EXIT INT TERM HUP

if [[ "${LIVE_SUPABASE_BIN}" != /* || ! -x "${LIVE_SUPABASE_BIN}" ]]; then
  live_fail 'Supabase CLI is unavailable; install it before running this script'
fi
if [[ "${LIVE_NODE_BIN}" != /* || ! -x "${LIVE_NODE_BIN}" ]]; then
  live_fail 'Node.js is unavailable; use the repository Node version'
fi
if [[ "$(git -C "${LIVE_REPO_ROOT}" branch --show-current)" != 'main' ]]; then
  live_fail 'live migrations must run from the main branch'
fi
if ! git -C "${LIVE_REPO_ROOT}" merge-base --is-ancestor \
  "${LIVE_MANIFEST_SOURCE_SHA}" HEAD; then
  live_fail 'main does not contain the reviewed migration release'
fi
if ! git -C "${LIVE_REPO_ROOT}" diff --quiet -- \
  supabase/migrations ops/budget-migrations.sha256 scripts/ops/migrate-budget.sh || \
  ! git -C "${LIVE_REPO_ROOT}" diff --cached --quiet -- \
  supabase/migrations ops/budget-migrations.sha256 scripts/ops/migrate-budget.sh; then
  live_fail 'migration files or their verification boundary have tracked changes'
fi

"${LIVE_SCRIPT_DIR}/migrate-budget.sh" verify-source-tree \
  "${LIVE_REPO_ROOT}/supabase/migrations" "${LIVE_MANIFEST_SOURCE_SHA}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  read -r -s -p 'Supabase personal access token: ' SUPABASE_ACCESS_TOKEN
  printf '\n'
  export SUPABASE_ACCESS_TOKEN
fi
if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  read -r -s -p 'Supabase database password: ' SUPABASE_DB_PASSWORD
  printf '\n'
  export SUPABASE_DB_PASSWORD
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN}" || -z "${SUPABASE_DB_PASSWORD}" || \
  "${SUPABASE_ACCESS_TOKEN}" == *$'\n'* || "${SUPABASE_ACCESS_TOKEN}" == *$'\r'* || \
  "${SUPABASE_DB_PASSWORD}" == *$'\n'* || "${SUPABASE_DB_PASSWORD}" == *$'\r'* ]]; then
  live_fail 'migration credentials are missing or malformed'
fi
unset SUPABASE_SERVICE_ROLE_KEY SUPABASE_SECRET_KEY

mkdir -p -- "${LIVE_BACKUP_REQUESTED}"
chmod 0700 "${LIVE_BACKUP_REQUESTED}"
readonly LIVE_BACKUP_ROOT="$(cd "${LIVE_BACKUP_REQUESTED}" && pwd -P)"
if [[ "${LIVE_BACKUP_ROOT}" != "${LIVE_BACKUP_REQUESTED}" || \
  "${LIVE_BACKUP_ROOT}" == '/' || "${LIVE_BACKUP_ROOT}" == "${HOME:-__unset_home__}" || \
  "${LIVE_BACKUP_ROOT}" == "${LIVE_REPO_ROOT}" ]] || \
  budget_is_protected_identifier "${LIVE_BACKUP_ROOT}"; then
  live_fail 'backup root is unresolved, overly broad, or protected'
fi

live_lock_dir="${LIVE_BACKUP_ROOT}/apply-live-migrations.lock"
if ! mkdir -- "${live_lock_dir}" 2>/dev/null; then
  live_fail 'another live migration run is active'
fi

readonly LIVE_RUN_ID="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
readonly LIVE_BACKUP_DIR="${LIVE_BACKUP_ROOT}/${LIVE_RUN_ID}"
mkdir -- "${LIVE_BACKUP_DIR}"
readonly LIVE_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/budget-live-migrations.XXXXXXXX")"
chmod 0700 "${LIVE_TEMP_DIR}"
readonly LIVE_EMPTY_APPLIED="${LIVE_TEMP_DIR}/empty-applied.txt"
readonly LIVE_PROJECTS_JSON="${LIVE_TEMP_DIR}/projects.json"
: > "${LIVE_EMPTY_APPLIED}"

"${LIVE_SCRIPT_DIR}/migrate-budget.sh" verify-manifest \
  "${LIVE_REPO_ROOT}/supabase/migrations" \
  "${LIVE_REPO_ROOT}/ops/budget-migrations.sha256" \
  "${LIVE_EMPTY_APPLIED}" "${LIVE_MANIFEST_SOURCE_SHA}"

if ! "${LIVE_SUPABASE_BIN}" projects list --output json > "${LIVE_PROJECTS_JSON}"; then
  live_fail 'Supabase account verification failed'
fi
readonly LIVE_PROJECTS_BYTES="$(wc -c < "${LIVE_PROJECTS_JSON}" | tr -d '[:space:]')"
if [[ ! "${LIVE_PROJECTS_BYTES}" =~ ^[0-9]+$ ]] || \
  (( LIVE_PROJECTS_BYTES == 0 || LIVE_PROJECTS_BYTES > LIVE_MAX_PROJECT_LIST_BYTES )); then
  live_fail 'Supabase project list is empty or unbounded'
fi
if ! "${LIVE_NODE_BIN}" -e '
  const fs = require("node:fs");
  const projects = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(projects) || !projects.some((project) =>
    project && (project.id === process.argv[2] || project.ref === process.argv[2]))) {
    process.exit(1);
  }
' "${LIVE_PROJECTS_JSON}" "${LIVE_PROJECT_REF}"; then
  live_fail 'authenticated account cannot access the exact project'
fi

"${LIVE_SUPABASE_BIN}" link --project-ref "${LIVE_PROJECT_REF}"
"${LIVE_SUPABASE_BIN}" db dump --linked --schema public \
  --file "${LIVE_BACKUP_DIR}/schema.sql"
"${LIVE_SUPABASE_BIN}" db dump --linked --schema public --data-only --use-copy \
  --file "${LIVE_BACKUP_DIR}/public-data.sql"
for live_backup_file in schema.sql public-data.sql; do
  if [[ ! -s "${LIVE_BACKUP_DIR}/${live_backup_file}" || \
    -L "${LIVE_BACKUP_DIR}/${live_backup_file}" ]]; then
    live_fail 'pre-migration backup is missing or invalid'
  fi
done

printf '%s\n' "Private pre-migration backup: ${LIVE_BACKUP_DIR}"
printf '%s\n' "Dry-running the reviewed migration journal against ${LIVE_PROJECT_REF}:"
"${LIVE_SUPABASE_BIN}" db push --linked --dry-run
printf '\nType exactly: %s\n> ' "${LIVE_CONFIRMATION}"
IFS= read -r live_confirmation
if [[ "${live_confirmation}" != "${LIVE_CONFIRMATION}" ]]; then
  live_fail 'confirmation did not match; no migrations were applied'
fi

"${LIVE_SUPABASE_BIN}" db push --linked --yes
"${LIVE_SUPABASE_BIN}" db push --linked --dry-run
readonly LIVE_VERIFY_OUTPUT="$(
  "${LIVE_SUPABASE_BIN}" db query --linked --output-format json "${LIVE_VERIFY_SQL}"
)"
if [[ "${LIVE_VERIFY_OUTPUT}" != *budget_schema_ready* || \
  "${LIVE_VERIFY_OUTPUT}" == *budget_schema_incomplete* ]]; then
  live_fail 'migration command returned but the exact Budget schema is incomplete'
fi

printf '%s\n' "Live Budget migrations verified on ${LIVE_PROJECT_REF}"
