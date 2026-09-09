#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly RESTORE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./budget-common.sh
source "${RESTORE_SCRIPT_DIR}/budget-common.sh"

readonly RESTORE_TIMEOUT_SECONDS=3600
readonly RESTORE_VERIFY_TIMEOUT_SECONDS=600
readonly RESTORE_HELPER_TIMEOUT_SECONDS=300
readonly RESTORE_HASH_TIMEOUT_SECONDS=60

restore_validate_live_gate() {
  local expected_confirmation="live:${BUDGET_PROJECT_ID:-}:${BUDGET_EXPECTED_SYSTEM_ID:-}"
  if [[ ! "${BUDGET_INCIDENT_ID:-}" =~ ^INC-[A-Za-z0-9._-]{4,64}$ || \
    "${BUDGET_LIVE_RESTORE_CONFIRM:-}" != "${expected_confirmation}" || \
    "${BUDGET_LIVE_APP_STOPPED:-0}" != '1' || \
    "${BUDGET_PRE_RESTORE_BACKUP_VERIFIED:-0}" != '1' || \
    ! "${BUDGET_OWNER_APPROVAL_ID:-}" =~ ^approval-[A-Za-z0-9._-]{4,64}$ ]]; then
    budget_error 'live restore safety prerequisites are incomplete' 74
    return
  fi
  budget_error 'live restore remains owner-gated; this tool executes scratch only' 74
}

restore_validate_configuration() {
  local restore_target="${BUDGET_RESTORE_TARGET:-scratch}"
  case "${restore_target}" in
    scratch) ;;
    live)
      restore_validate_live_gate
      return
      ;;
    *)
      budget_error 'restore target must be exactly scratch or owner-gated live' 74
      return
      ;;
  esac

  budget_validate_environment >/dev/null
  if [[ "${BUDGET_VALIDATED_ENV}" != 'live' ]]; then
    budget_error 'restore source must be the exact live Budget environment' 75
    return
  fi
  if [[ -z "${BUDGET_AGE_IDENTITY_FILE:-}" ]]; then
    budget_error 'restore age identity is not configured' 75
    return
  fi
  if [[ -z "${BUDGET_OFFSITE_DESTINATION:-}" ]]; then
    budget_error 'off-site destination is not configured' 75
    return
  fi
  if [[ -z "${BUDGET_EXPECTED_MANIFEST_SHA256:-}" ]]; then
    budget_error 'trusted manifest hash is not configured' 75
    return
  fi
  if [[ ! "${BUDGET_EXPECTED_MANIFEST_SHA256}" =~ ^[a-f0-9]{64}$ ]]; then
    budget_error 'trusted manifest hash is invalid' 75
    return
  fi

  local required_value
  for required_value in BUDGET_RECOVERY_POINT BUDGET_SCRATCH_ROOT \
    BUDGET_SCRATCH_MARKER_PATH BUDGET_SCRATCH_PROJECT_ID BUDGET_SCRATCH_PORT \
    BUDGET_SCRATCH_EXPECTED_SYSTEM_ID BUDGET_SCRATCH_ACTUAL_SYSTEM_ID \
    BUDGET_SCRATCH_EMPTY BUDGET_SCRATCH_POSTGRES_MAJOR \
    BUDGET_SCRATCH_REQUIRED_BYTES BUDGET_SCRATCH_AVAILABLE_BYTES \
    BUDGET_PGPASS_FILE BUDGET_DATABASE_HOST BUDGET_DATABASE_USER \
    BUDGET_ROLE_ALLOWLIST BUDGET_TIMEOUT_BIN BUDGET_AGE_BIN \
    BUDGET_OFFSITE_BIN BUDGET_PG_RESTORE_BIN BUDGET_PSQL_BIN \
    BUDGET_ROLE_FILTER_BIN BUDGET_COMPARE_BIN; do
    if [[ -z "${!required_value:-}" ]]; then
      budget_error "required restore setting is missing: ${required_value}" 75
      return
    fi
  done


  local database_identifier
  for database_identifier in "${BUDGET_DATABASE_HOST}" "${BUDGET_DATABASE_USER}" \
    "${BUDGET_PGPASS_FILE}"; do
    if budget_is_protected_identifier "${database_identifier}"; then
      budget_error 'protected Sandooq/POS database identifier refused' 75
      return
    fi
  done

  if [[ ! "${BUDGET_RECOVERY_POINT}" =~ ^[0-9TZ:-]{16,32}-[A-Za-z0-9._-]{1,64}$ || \
    "${BUDGET_SCRATCH_PROJECT_ID}" != 'budget-restore-scratch' || \
    "${BUDGET_SCRATCH_PORT}" != '54722' || \
    "${BUDGET_SCRATCH_POSTGRES_MAJOR}" != '17' || \
    ! "${BUDGET_SCRATCH_REQUIRED_BYTES}" =~ ^[0-9]{1,20}$ || \
    ! "${BUDGET_SCRATCH_AVAILABLE_BYTES}" =~ ^[0-9]{1,20}$ || \
    ! "${BUDGET_ROLE_ALLOWLIST}" =~ ^budget_[a-z_]+(,budget_[a-z_]+){0,15}$ ]]; then
    budget_error 'scratch restore configuration is outside the exact allowlist' 76
    return
  fi
  if budget_is_protected_identifier "${BUDGET_SCRATCH_ROOT}" || \
    budget_is_protected_identifier "${BUDGET_SCRATCH_PROJECT_ID}" || \
    budget_is_protected_identifier "${BUDGET_OFFSITE_DESTINATION}"; then
    budget_error 'scratch restore contains a protected Sandooq/POS identifier' 76
    return
  fi
  budget_validate_safe_path "${BUDGET_SCRATCH_ROOT}" "${BUDGET_SCRATCH_PROJECT_ID}"
  if [[ "${BUDGET_SCRATCH_MARKER_PATH}" != "${BUDGET_SCRATCH_ROOT}/.budget-ops-marker" ]]; then
    budget_error 'scratch marker path is unsafe' 76
    return
  fi
  if [[ ! -f "${BUDGET_SCRATCH_MARKER_PATH}" ]]; then
    budget_error 'scratch marker is missing' 76
    return
  fi

  local scratch_marker
  scratch_marker="$(<"${BUDGET_SCRATCH_MARKER_PATH}")"
  if [[ "${scratch_marker}" != "budget-restore-marker-v1
target=scratch
project=${BUDGET_SCRATCH_PROJECT_ID}
system_id=${BUDGET_SCRATCH_EXPECTED_SYSTEM_ID}" ]]; then
    budget_error 'scratch marker identity mismatch' 76
    return
  fi
  if [[ ! "${BUDGET_SCRATCH_EXPECTED_SYSTEM_ID}" =~ ^[0-9]{10,22}$ || \
    "${BUDGET_SCRATCH_ACTUAL_SYSTEM_ID}" != "${BUDGET_SCRATCH_EXPECTED_SYSTEM_ID}" ]]; then
    budget_error 'scratch system identifier mismatch' 76
    return
  fi
  if [[ "${BUDGET_SCRATCH_EXPECTED_SYSTEM_ID}" == "${BUDGET_VALIDATED_SYSTEM_ID}" ]]; then
    budget_error 'scratch system identifier must differ from live' 76
    return
  fi
  if [[ "${BUDGET_SCRATCH_EMPTY}" != '1' ]]; then
    budget_error 'scratch database is not empty' 76
    return
  fi
  if (( BUDGET_SCRATCH_AVAILABLE_BYTES < BUDGET_SCRATCH_REQUIRED_BYTES )); then
    budget_error 'insufficient scratch restore space' 76
    return
  fi
  budget_require_private_file "${BUDGET_AGE_IDENTITY_FILE}" 75
  budget_require_private_file "${BUDGET_PGPASS_FILE}" 75

  local executable
  for executable in "${BUDGET_TIMEOUT_BIN}" "${BUDGET_AGE_BIN}" \
    "${BUDGET_OFFSITE_BIN}" "${BUDGET_PG_RESTORE_BIN}" \
    "${BUDGET_PSQL_BIN}" "${BUDGET_ROLE_FILTER_BIN}" "${BUDGET_COMPARE_BIN}"; do
    if [[ "${executable}" != /* || ! -x "${executable}" ]]; then
      budget_error 'restore executable boundary is not an absolute executable' 75
      return
    fi
  done

  readonly RESTORE_TARGET="scratch"
  readonly RESTORE_POINT="${BUDGET_RECOVERY_POINT}"
  readonly RESTORE_ROOT="${BUDGET_SCRATCH_ROOT}"
  readonly RESTORE_TIMEOUT_BIN="${BUDGET_TIMEOUT_BIN}"
}

restore_hash() {
  local candidate="${1:?hash candidate is required}"
  local output
  output="$("${RESTORE_TIMEOUT_BIN}" "${RESTORE_HASH_TIMEOUT_SECONDS}" shasum -a 256 "${candidate}")"
  printf '%s\n' "${output%% *}"
}

restore_cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ "${restore_temp_created:-0}" == '1' ]]; then
    rm -f -- "${restore_manifest}" "${restore_archive_cipher}" \
      "${restore_roles_cipher}" "${restore_catalog_cipher}" \
      "${restore_archive_plain}" "${restore_roles_plain}" \
      "${restore_catalog_plain}" "${restore_roles_filtered}" \
      "${restore_archive_list}"
    rmdir -- "${restore_temp_dir}" 2>/dev/null || true
  fi
  if [[ "${restore_lock_acquired:-0}" == '1' ]]; then
    rmdir -- "${restore_lock_dir}" 2>/dev/null || true
  fi
  exit "${status}"
}

restore_manifest_value() {
  local key="${1:?manifest key is required}"
  local manifest="${2:?manifest is required}"
  local line found=''
  while IFS= read -r line; do
    if [[ "${line}" == "${key}="* ]]; then
      [[ -n "${found}" ]] && return 1
      found="${line#*=}"
    fi
  done < "${manifest}"
  [[ -n "${found}" ]] || return 1
  printf '%s\n' "${found}"
}

restore_expected_hash() {
  local filename="${1:?ciphertext filename is required}"
  local manifest="${2:?manifest is required}"
  local line hash found=''
  while IFS= read -r line; do
    if [[ "${line}" == *"  ${filename}" ]]; then
      [[ -n "${found}" ]] && return 1
      hash="${line%% *}"
      [[ "${hash}" =~ ^[a-f0-9]{64}$ ]] || return 1
      found="${hash}"
    fi
  done < "${manifest}"
  [[ -n "${found}" ]] || return 1
  printf '%s\n' "${found}"
}

restore_execute() {
  restore_validate_configuration

  local restore_lock_acquired=0 restore_temp_created=0
  local restore_lock_dir="${RESTORE_ROOT}/locks/restore-scratch.lock"
  local restore_temp_dir="${RESTORE_ROOT}/tmp/${RESTORE_POINT}.restore"
  local restore_manifest="${restore_temp_dir}/manifest.txt"
  local restore_archive_cipher="${restore_temp_dir}/archive.dump.age"
  local restore_roles_cipher="${restore_temp_dir}/roles.sql.age"
  local restore_catalog_cipher="${restore_temp_dir}/catalog.txt.age"
  local restore_archive_plain="${restore_temp_dir}/archive.dump"
  local restore_roles_plain="${restore_temp_dir}/roles.sql"
  local restore_catalog_plain="${restore_temp_dir}/catalog.txt"
  local restore_roles_filtered="${restore_temp_dir}/roles.allowlisted.sql"
  local restore_archive_list="${restore_temp_dir}/archive.list"
  trap restore_cleanup EXIT INT TERM HUP

  mkdir -p -- "${RESTORE_ROOT}/locks"
  if ! mkdir -- "${restore_lock_dir}" 2>/dev/null; then
    budget_error 'restore is already running' 77
    return
  fi
  restore_lock_acquired=1
  mkdir -p -- "${RESTORE_ROOT}/tmp"
  if ! mkdir -- "${restore_temp_dir}"; then
    budget_error 'restore temporary directory already exists' 77
    return
  fi
  restore_temp_created=1

  local filename local_path
  for filename in manifest.txt archive.dump.age roles.sql.age catalog.txt.age; do
    local_path="${restore_temp_dir}/${filename}"
    "${RESTORE_TIMEOUT_BIN}" "${RESTORE_HELPER_TIMEOUT_SECONDS}" \
      "${BUDGET_OFFSITE_BIN}" get "${BUDGET_OFFSITE_DESTINATION}" \
      "${RESTORE_POINT}/${filename}" "${local_path}"
  done

  local trusted_manifest_hash
  trusted_manifest_hash="$(restore_hash "${restore_manifest}")"
  if [[ "${trusted_manifest_hash}" != "${BUDGET_EXPECTED_MANIFEST_SHA256}" ]]; then
    budget_error 'trusted manifest hash mismatch' 78
    return
  fi

  budget_scan_secrets "${restore_manifest}" >/dev/null
  local manifest_run_id manifest_environment manifest_project manifest_system_id manifest_major
  manifest_run_id="$(restore_manifest_value run_id "${restore_manifest}")" || {
    budget_error 'restore manifest is invalid' 78; return; }
  manifest_environment="$(restore_manifest_value environment "${restore_manifest}")" || {
    budget_error 'restore manifest is invalid' 78; return; }
  manifest_project="$(restore_manifest_value project "${restore_manifest}")" || {
    budget_error 'restore manifest is invalid' 78; return; }
  manifest_system_id="$(restore_manifest_value system_id "${restore_manifest}")" || {
    budget_error 'restore manifest is invalid' 78; return; }
  manifest_major="$(restore_manifest_value postgres_major "${restore_manifest}")" || {
    budget_error 'restore manifest is invalid' 78; return; }
  if [[ "${manifest_run_id}" != "${RESTORE_POINT}" || \
    "${manifest_environment}" != 'live' || \
    "${manifest_project}" != "${BUDGET_VALIDATED_PROJECT}" || \
    "${manifest_system_id}" != "${BUDGET_VALIDATED_SYSTEM_ID}" || \
    "${manifest_major}" != "${BUDGET_SCRATCH_POSTGRES_MAJOR}" ]]; then
    budget_error 'restore manifest identity mismatch' 78
    return
  fi

  local expected_hash actual_hash
  for filename in archive.dump.age roles.sql.age catalog.txt.age; do
    expected_hash="$(restore_expected_hash "${filename}" "${restore_manifest}")" || {
      budget_error 'restore manifest ciphertext hash is missing' 78; return; }
    actual_hash="$(restore_hash "${restore_temp_dir}/${filename}")"
    if [[ "${actual_hash}" != "${expected_hash}" ]]; then
      budget_error 'ciphertext hash mismatch' 78
      return
    fi
  done

  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_AGE_BIN}" -d -i "${BUDGET_AGE_IDENTITY_FILE}" \
    -o "${restore_archive_plain}" "${restore_archive_cipher}"
  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_AGE_BIN}" -d -i "${BUDGET_AGE_IDENTITY_FILE}" \
    -o "${restore_roles_plain}" "${restore_roles_cipher}"
  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_AGE_BIN}" -d -i "${BUDGET_AGE_IDENTITY_FILE}" \
    -o "${restore_catalog_plain}" "${restore_catalog_cipher}"
  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_PG_RESTORE_BIN}" --list "${restore_archive_plain}" > "${restore_archive_list}"
  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_ROLE_FILTER_BIN}" "${restore_roles_plain}" \
    "${restore_roles_filtered}" "${BUDGET_ROLE_ALLOWLIST}"

  export PGPASSFILE="${BUDGET_PGPASS_FILE}"
  export PGCONNECT_TIMEOUT=5
  export PGOPTIONS='-c lock_timeout=30s -c statement_timeout=59min'
  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_VERIFY_TIMEOUT_SECONDS}" \
    "${BUDGET_PSQL_BIN}" --set=ON_ERROR_STOP=on \
    --host="${BUDGET_DATABASE_HOST}" --port="${BUDGET_SCRATCH_PORT}" \
    --username="${BUDGET_DATABASE_USER}" --dbname=budget_restore_scratch \
    --file="${restore_roles_filtered}"
  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_TIMEOUT_SECONDS}" \
    "${BUDGET_PG_RESTORE_BIN}" --exit-on-error --jobs=1 \
    --host="${BUDGET_DATABASE_HOST}" --port="${BUDGET_SCRATCH_PORT}" \
    --username="${BUDGET_DATABASE_USER}" --dbname=budget_restore_scratch \
    "${restore_archive_plain}"
  "${RESTORE_TIMEOUT_BIN}" "${RESTORE_VERIFY_TIMEOUT_SECONDS}" \
    "${BUDGET_COMPARE_BIN}" --source-manifest="${restore_manifest}" \
    --source-catalog="${restore_catalog_plain}" --target=scratch \
    --max-row-summaries=100 --max-content-hashes=100

  printf '%s\n' "scratch restore comparison verified for ${RESTORE_POINT}"
}

restore_dry_run() {
  restore_validate_configuration
  printf '%s\n' "restore_target=${RESTORE_TARGET}"
  printf '%s\n' 'DRY RUN ONLY: no lock, fetch, decrypt, role, restore, compare, cleanup, database, or network command executed'
  printf '%s\n' 'real-data recovery evidence remains BLOCKED until measured scratch restore and operator approval'
}

case "${1:-}" in
  restore) restore_execute ;;
  dry-run) restore_dry_run ;;
  *) budget_error 'usage: restore-budget.sh {restore|dry-run}' 64 ;;
esac
