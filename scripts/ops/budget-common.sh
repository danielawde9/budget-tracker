#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly BUDGET_COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly BUDGET_OPS_REPO_ROOT="$(cd "${BUDGET_COMMON_SCRIPT_DIR}/../.." && pwd -P)"
readonly BUDGET_MAX_SCAN_FILES=256
readonly BUDGET_MAX_SCAN_BYTES=10485760

budget_error() {
  local message="${1:?error message is required}"
  local status="${2:-1}"
  printf '%s\n' "budget ops: ${message}" >&2
  return "${status}"
}

budget_is_protected_identifier() {
  local value="${1:-}"
  local lowered
  lowered="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  [[ "${lowered}" =~ (^|[^[:alnum:]])(sandooq|pos)([^[:alnum:]]|$) ]]
}

budget_validate_safe_path() {
  local path="${1:-}"
  local expected_basename="${2:-}"

  if [[ -z "${path}" || "${path}" != /* || "${path}" == '/' || \
    "${path}" == '/home/lelabo' || "${path}" == '~' || \
    "${path}" == "${HOME:-__unset_home__}" || \
    "${path}" == "${BUDGET_OPS_REPO_ROOT}" || \
    "${path}" == *'$'* || "${path}" == *'{'* || "${path}" == *'}'* || \
    "${path}" == *'*'* || "${path}" == *'?'* || "${path}" == *'['* || \
    "${path}" == *'/../'* || "${path}" == */.. ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi

  if [[ -n "${expected_basename}" && "${path##*/}" != "${expected_basename}" ]]; then
    budget_error 'unsafe Budget root' 66
  fi
}

budget_require_private_file() {
  local path="${1:-}"
  local status="${2:-1}"
  if [[ -z "${path}" || ! -f "${path}" ]]; then
    budget_error 'secret file reference is missing' "${status}"
    return
  fi
  if ! /usr/bin/perl -e '
    alarm 5;
    my @details = stat($ARGV[0]);
    exit 1 unless @details;
    exit((($details[2] & 0777) == 0600 && $details[4] == $<) ? 0 : 1);
  ' "${path}"; then
    budget_error 'secret file must be mode 0600 and operator-owned' "${status}"
  fi
}

budget_expected_project() {
  case "${1:-}" in
    development) printf '%s\n' 'budget-supabase' ;;
    uat) printf '%s\n' 'budget-uat' ;;
    live) printf '%s\n' 'budget-live' ;;
    *) return 1 ;;
  esac
}

budget_expected_port_range() {
  case "${1:-}" in
    development) printf '%s\n' '54420-54429' ;;
    uat) printf '%s\n' '54520-54529' ;;
    live) printf '%s\n' '54620-54629' ;;
    *) return 1 ;;
  esac
}

budget_validate_environment() {
  local environment="${BUDGET_ENV:-}"
  local root="${BUDGET_ROOT:-}"
  local marker="${BUDGET_MARKER_PATH:-}"
  local project="${BUDGET_PROJECT_ID:-}"
  local hostname="${BUDGET_HOSTNAME:-}"
  local volume="${BUDGET_VOLUME:-}"
  local network="${BUDGET_NETWORK:-}"
  local port_range="${BUDGET_PORT_RANGE:-}"
  local expected_system_id="${BUDGET_EXPECTED_SYSTEM_ID:-}"
  local expected_project expected_port marker_contents

  case "${environment}" in
    development|uat|live) ;;
    *)
      budget_error 'environment must be exactly development, uat, or live' 64
      return
      ;;
  esac

  for value in "${root}" "${marker}" "${project}" "${hostname}" "${volume}" \
    "${network}" "${port_range}" "${expected_system_id}"; do
    if budget_is_protected_identifier "${value}"; then
      budget_error 'protected Sandooq/POS identifier refused' 65
      return
    fi
  done

  expected_project="$(budget_expected_project "${environment}")"
  expected_port="$(budget_expected_port_range "${environment}")"
  local identity_stem
  case "${environment}" in
    development) identity_stem='budget-supabase' ;;
    uat) identity_stem='budget-uat' ;;
    live) identity_stem='budget-live' ;;
  esac
  if [[ "${project}" != "${expected_project}" || "${port_range}" != "${expected_port}" || \
    ( "${hostname}" != "${identity_stem}."* && "${hostname}" != "${identity_stem}-"* ) || \
    "${volume}" != "${identity_stem}-"* || \
    "${network}" != "${identity_stem}-"* ]]; then
    budget_error 'target is outside the exact Budget allowlist' 65
    return
  fi

  budget_validate_safe_path "${root}" "${project}"
  if [[ "${marker}" != "${root}/.budget-ops-marker" ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi
  if [[ ! "${expected_system_id}" =~ ^[0-9]{10,22}$ ]]; then
    budget_error 'database system identifier must be an exact numeric value' 68
    return
  fi

  if [[ ! -f "${marker}" ]]; then
    budget_error 'environment marker is missing' 67
    return
  fi
  marker_contents="$(<"${marker}")"
  if [[ "${marker_contents}" != "budget-ops-marker-v1
environment=${environment}
project=${project}
system_id=${expected_system_id}" ]]; then
    budget_error 'environment marker identity mismatch' 67
    return
  fi
  readonly BUDGET_VALIDATED_ENV="${environment}"
  readonly BUDGET_VALIDATED_ROOT="${root}"
  readonly BUDGET_VALIDATED_PROJECT="${project}"
  readonly BUDGET_VALIDATED_SYSTEM_ID="${expected_system_id}"
  printf '%s\n' "validated Budget ${environment} target"
}

budget_assert_database_receipt() {
  local receipt="${1:-}"
  local expected_system_id="${2:-}"
  local expected_major="${3:-}"
  local expected_database="${4:-}"
  local expected_oid="${5:-}"
  local require_empty="${6:-0}"
  local status="${7:-68}"
  local mismatch_message="${8:-measured database identity mismatch}"
  local system_id major database oid relation_count extra

  IFS='|' read -r system_id major database oid relation_count extra <<< "${receipt}"
  if [[ ! "${system_id}" =~ ^[0-9]{10,22}$ || \
    ! "${major}" =~ ^[0-9]{1,3}$ || \
    ! "${database}" =~ ^[a-z][a-z0-9_]{0,62}$ || \
    ! "${oid}" =~ ^[0-9]{1,20}$ || \
    ! "${relation_count}" =~ ^[0-9]{1,20}$ || -n "${extra}" ]]; then
    budget_error 'database verifier returned an invalid bounded receipt' "${status}"
    return
  fi
  if [[ "${system_id}" != "${expected_system_id}" || \
    "${major}" != "${expected_major}" || \
    "${database}" != "${expected_database}" || "${oid}" != "${expected_oid}" ]]; then
    budget_error "${mismatch_message}" "${status}"
    return
  fi
  if [[ "${require_empty}" == '1' && "${relation_count}" != '0' ]]; then
    budget_error 'measured scratch database is not empty' "${status}"
    return
  fi
  printf '%s\n' "${receipt}"
}

budget_scan_secrets() {
  if (( $# == 0 || $# > BUDGET_MAX_SCAN_FILES )); then
    budget_error 'secret scan requires 1 to 256 explicit files' 64
    return
  fi

  local candidate size content line secret display_name
  for candidate in "$@"; do
    if [[ ! -f "${candidate}" ]]; then
      budget_error 'secret scan candidate is not a regular file' 64
      return
    fi
    size="$(wc -c < "${candidate}")"
    if (( size > BUDGET_MAX_SCAN_BYTES )); then
      budget_error 'secret scan candidate exceeds 10 MiB' 64
      return
    fi
    content="$(<"${candidate}")"
    display_name="${candidate##*/}"

    while IFS= read -r secret; do
      if [[ -n "${secret}" && "${content}" == *"${secret}"* ]]; then
        budget_error "secret material detected in ${display_name}" 69
        return
      fi
    done <<< "${BUDGET_DISCOVERED_SECRETS:-}"

    local assigned_value
    while IFS= read -r line; do
      if [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?(SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|DB_PASSWORD|SMTP_(PASSWORD|TOKEN)|AGE_IDENTITY|ADMIN_TOKEN)[[:space:]]*= ]]; then
        assigned_value="${line#*=}"
        if [[ ! "${assigned_value}" =~ ^[[:space:]]*$ && \
          "${assigned_value}" != *'${'* && "${assigned_value}" != *'<'* ]]; then
          budget_error "secret material detected in ${display_name}" 69
          return
        fi
      fi
    done < "${candidate}"
  done

  printf '%s\n' "secret scan passed for $# file(s)"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    validate-environment) budget_validate_environment ;;
    scan-secrets)
      shift
      budget_scan_secrets "$@"
      ;;
    *)
      budget_error 'usage: budget-common.sh {validate-environment|scan-secrets}' 64
      ;;
  esac
fi
