#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly LIVE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly LIVE_REPO_ROOT="$(cd "${LIVE_SCRIPT_DIR}/../.." && pwd -P)"
# shellcheck source=./budget-common.sh
source "${LIVE_SCRIPT_DIR}/budget-common.sh"

readonly LIVE_PROJECT_REF='hqblhzqitrbvpyoxtmew'
readonly LIVE_MANIFEST_SOURCE_SHA='41399f6ca54f8d207474313b159af1c9c723ea84'
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
  and (select array_agg(version order by version) from supabase_migrations.schema_migrations)
    = array[
      '20260907100000','20260907110000','20260907120000','20260907130000',
      '20260907140000','20260907141000','20260907142000','20260907143000',
      '20260907144000','20260907145000','20260907146000','20260907147000',
      '20260907148000','20260907149000','20260908100000','20260908101000',
      '20260908102000','20260908103000','20260908170000','20260908171000',
      '20260908171100','20260908172000','20260908173000','20260908173100',
      '20260908174000','20260908175000','20260908176000','20260908177000',
      '20260908178000','20260908179000','20260908180000','20260910100000'
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
