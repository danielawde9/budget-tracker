#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly DRIFT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DRIFT_REPO_ROOT="$(cd "${DRIFT_SCRIPT_DIR}/../.." && pwd -P)"
# shellcheck source=./budget-common.sh
source "${DRIFT_SCRIPT_DIR}/budget-common.sh"

# Read-only sibling of apply-live-migrations.sh: proves whether the local
# supabase/migrations journal and the live database agree, without ever
# writing anything. Same exact-project verification, same credential
# handling; no backup, no dry-run, no push, no confirmation phrase, because
# nothing here can change the database.
readonly DRIFT_PROJECT_REF='hqblhzqitrbvpyoxtmew'
readonly DRIFT_MAX_PROJECT_LIST_BYTES=1048576
readonly DRIFT_SUPABASE_BIN="${BUDGET_SUPABASE_BIN:-$(command -v supabase || true)}"
readonly DRIFT_NODE_BIN="$(command -v node || true)"

drift_fail() {
  budget_error "$1" 78
  exit 78
}

drift_cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
  if [[ -n "${DRIFT_TEMP_DIR:-}" && -d "${DRIFT_TEMP_DIR}" && ! -L "${DRIFT_TEMP_DIR}" ]]; then
    rm -f -- "${DRIFT_TEMP_DIR}/projects.json" "${DRIFT_TEMP_DIR}/remote-versions.json"
    rmdir -- "${DRIFT_TEMP_DIR}" 2>/dev/null || true
  fi
  exit "${status}"
}
trap drift_cleanup EXIT INT TERM HUP

if [[ "${DRIFT_SUPABASE_BIN}" != /* || ! -x "${DRIFT_SUPABASE_BIN}" ]]; then
  drift_fail 'Supabase CLI is unavailable; install it before running this check'
fi
if [[ "${DRIFT_NODE_BIN}" != /* || ! -x "${DRIFT_NODE_BIN}" ]]; then
  drift_fail 'Node.js is unavailable; use the repository Node version'
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
  drift_fail 'drift-check credentials are missing or malformed'
fi
unset SUPABASE_SERVICE_ROLE_KEY SUPABASE_SECRET_KEY

readonly DRIFT_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/budget-live-drift.XXXXXXXX")"
chmod 0700 "${DRIFT_TEMP_DIR}"
readonly DRIFT_PROJECTS_JSON="${DRIFT_TEMP_DIR}/projects.json"
readonly DRIFT_REMOTE_JSON="${DRIFT_TEMP_DIR}/remote-versions.json"

if ! "${DRIFT_SUPABASE_BIN}" projects list --output json > "${DRIFT_PROJECTS_JSON}"; then
  drift_fail 'Supabase account verification failed'
fi
readonly DRIFT_PROJECTS_BYTES="$(wc -c < "${DRIFT_PROJECTS_JSON}" | tr -d '[:space:]')"
if [[ ! "${DRIFT_PROJECTS_BYTES}" =~ ^[0-9]+$ ]] || \
  (( DRIFT_PROJECTS_BYTES == 0 || DRIFT_PROJECTS_BYTES > DRIFT_MAX_PROJECT_LIST_BYTES )); then
  drift_fail 'Supabase project list is empty or unbounded'
fi
if ! "${DRIFT_NODE_BIN}" -e '
  const fs = require("node:fs");
  const projects = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(projects) || !projects.some((project) =>
    project && (project.id === process.argv[2] || project.ref === process.argv[2]))) {
    process.exit(1);
  }
' "${DRIFT_PROJECTS_JSON}" "${DRIFT_PROJECT_REF}"; then
  drift_fail 'authenticated account cannot access the exact project'
fi

"${DRIFT_SUPABASE_BIN}" link --project-ref "${DRIFT_PROJECT_REF}"

if ! "${DRIFT_SUPABASE_BIN}" db query --linked --output-format json \
  "select coalesce(array_agg(version order by version), array[]::text[]) as versions from supabase_migrations.schema_migrations" \
  > "${DRIFT_REMOTE_JSON}"; then
  drift_fail 'could not read the remote migration history'
fi

if ! "${DRIFT_NODE_BIN}" "${DRIFT_SCRIPT_DIR}/check-live-migration-drift.mjs" \
  "${DRIFT_REPO_ROOT}/supabase/migrations" "${DRIFT_REMOTE_JSON}"; then
  drift_fail 'local migrations and the live database have drifted apart -- see the versions listed above'
fi

printf '%s\n' "Local migrations and ${DRIFT_PROJECT_REF} agree exactly."
