#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

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

budget_monotonic_seconds() {
  /usr/bin/perl -MTime::HiRes=clock_gettime,CLOCK_MONOTONIC -e '
    alarm 5;
    printf "%d\n", int(clock_gettime(CLOCK_MONOTONIC));
  '
}

budget_start_deadline() {
  local total_seconds="${1:-}"
  local started_at
  [[ "${total_seconds}" =~ ^[1-9][0-9]{0,5}$ ]] || return 1
  started_at="$(budget_monotonic_seconds)"
  printf '%s\n' "$((started_at + total_seconds))"
}

budget_run_before_deadline() {
  local deadline="${1:?deadline is required}"
  local status="${2:?status is required}"
  local timeout_bin="${3:?timeout binary is required}"
  shift 3
  local now remaining
  now="$(budget_monotonic_seconds)"
  remaining=$((deadline - now))
  if (( remaining <= 0 )); then
    budget_error 'whole-operation deadline exceeded' "${status}"
    return
  fi
  "${timeout_bin}" "${remaining}" "$@"
}

budget_file_sha256() {
  local candidate="${1:-}"
  local output
  output="$(/usr/bin/shasum -a 256 "${candidate}")" || return
  printf '%s\n' "${output%% *}"
}

budget_validate_executable_hash() {
  local candidate="${1:-}"
  local expected_hash="${2:-}"
  local status="${3:-70}"
  local resolved actual_hash

  if [[ "${candidate}" != /* || ! -x "${candidate}" || \
    ! "${expected_hash}" =~ ^[a-f0-9]{64}$ ]]; then
    budget_error 'PostgreSQL executable contract is invalid' "${status}"
    return
  fi
  resolved="$(/usr/bin/perl -MCwd=abs_path -e 'alarm 5; print abs_path($ARGV[0]) // ""' \
    "${candidate}")"
  if [[ "${resolved}" != "${candidate}" || "${resolved}" == '/usr/bin/true' || \
    "${resolved}" == '/bin/true' || "${resolved}" == '/usr/bin/false' || \
    "${resolved}" == '/bin/false' ]]; then
    budget_error 'placeholder PostgreSQL executable refused' "${status}"
    return
  fi
  actual_hash="$(budget_file_sha256 "${candidate}")"
  if [[ "${actual_hash}" != "${expected_hash}" ]]; then
    budget_error 'PostgreSQL executable hash mismatch' "${status}"
    return
  fi
}

budget_validate_postgres_binary() {
  local candidate="${1:-}"
  local expected_hash="${2:-}"
  local product="${3:-}"
  local expected_version="${4:-}"
  local status="${5:-70}"
  local version_output

  budget_validate_executable_hash "${candidate}" "${expected_hash}" "${status}"
  version_output="$(/usr/bin/perl -e 'alarm 5; exec @ARGV or die "exec failed\n"' \
    "${candidate}" --version)"
  if [[ "${version_output}" != "${product} (PostgreSQL) ${expected_version}" && \
    "${version_output}" != "${product} (PostgreSQL) ${expected_version} "* ]]; then
    budget_error 'measured PostgreSQL version mismatch' "${status}"
  fi
}

budget_validate_source_commit() {
  local expected="${1:-}"
  local status="${2:-70}"
  local actual
  if [[ ! "${expected}" =~ ^[a-f0-9]{40}$ ]]; then
    budget_error 'source commit provenance is invalid' "${status}"
    return
  fi
  actual="$(/usr/bin/git -C "${BUDGET_OPS_REPO_ROOT}" rev-parse HEAD)"
  if [[ "${actual}" != "${expected}" ]]; then
    budget_error 'source commit provenance mismatch' "${status}"
  fi
}

budget_is_protected_identifier() {
  local value="${1:-}"
  local lowered
  lowered="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  [[ "${lowered}" =~ (^|[^[:alnum:]])(sandooq|pos)([^[:alnum:]]|$) ]]
}

budget_validate_offsite_destination() {
  local destination="${1:-}"
  local allowed_prefix="${2:-}"
  local status="${3:-70}"

  if [[ -z "${destination}" || ${#destination} -gt 256 || \
    -z "${allowed_prefix}" || ${#allowed_prefix} -gt 128 || \
    "${destination}" != "${allowed_prefix}" || \
    ! "${destination}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ || \
    ! "${allowed_prefix}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || \
    budget_is_protected_identifier "${destination}"; then
    budget_error 'off-site destination is outside the exact allowlist' "${status}"
  fi
}

budget_assert_offsite_receipt() {
  local receipt="${1:-}"
  local expected_provider="${2:-}"
  local expected_key="${3:-}"
  local expected_size="${4:-}"
  local expected_hash="${5:-}"
  local status="${6:-70}"
  local version provider object_key object_version remote_size remote_hash immutable monitoring extra

  IFS='|' read -r version provider object_key object_version remote_size remote_hash \
    immutable monitoring extra <<< "${receipt}"
  if [[ ${#receipt} -gt 1024 || "${version}" != 'receipt_version=1' || \
    "${provider}" != "provider=${expected_provider}" || \
    "${object_key}" != "object_key=${expected_key}" || \
    ! "${object_version}" =~ ^object_version=[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ || \
    "${remote_size}" != "remote_size=${expected_size}" || \
    "${remote_hash}" != "remote_sha256=${expected_hash}" || \
    "${immutable}" != 'immutable=1' || "${monitoring}" != 'monitoring=1' || \
    -n "${extra}" || ! "${expected_provider}" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ || \
    ! "${expected_key}" =~ ^[A-Za-z0-9TZ:._-]{1,128}/[A-Za-z0-9._-]{1,64}$ || \
    ! "${expected_size}" =~ ^[0-9]{1,20}$ || \
    ! "${expected_hash}" =~ ^[a-f0-9]{64}$ ]]; then
    budget_error 'off-site receipt is invalid' "${status}"
    return
  fi
  printf '%s\n' "${receipt}"
}

budget_assert_comparison_receipt() {
  local receipt="${1:-}"
  local expected_manifest_hash="${2:-}"
  local expected_catalog_hash="${3:-}"
  local status="${4:-78}"
  local version comparison_status target manifest_hash catalog_hash extra

  IFS='|' read -r version comparison_status target manifest_hash catalog_hash extra <<< "${receipt}"
  if [[ ${#receipt} -gt 512 || "${version}" != 'comparison_version=1' || \
    "${comparison_status}" != 'status=verified' || "${target}" != 'target=scratch' || \
    "${manifest_hash}" != "manifest_sha256=${expected_manifest_hash}" || \
    "${catalog_hash}" != "catalog_sha256=${expected_catalog_hash}" || \
    -n "${extra}" || ! "${expected_manifest_hash}" =~ ^[a-f0-9]{64}$ || \
    ! "${expected_catalog_hash}" =~ ^[a-f0-9]{64}$ ]]; then
    budget_error 'comparison receipt is invalid' "${status}"
    return
  fi
  printf '%s\n' "${receipt}"
}

budget_validate_safe_path() {
  local path="${1:-}"
  local expected_basename="${2:-}"
  local trusted_parent="${3:-}"

  if [[ -z "${path}" || "${path}" != /* || "${path}" == '/' || \
    "${path}" == '/home/lelabo' || "${path}" == '~' || \
    "${path}" == "${HOME:-__unset_home__}" || \
    "${path}" == "${BUDGET_OPS_REPO_ROOT}" || -z "${trusted_parent}" || \
    "${trusted_parent}" != /* || \
    "${path}" == *'$'* || "${path}" == *'{'* || "${path}" == *'}'* || \
    "${path}" == *'*'* || "${path}" == *'?'* || "${path}" == *'['* || \
    "${path}" == *'/../'* || "${path}" == */.. || \
    "${path}" == *$'\n'* || "${trusted_parent}" == *$'\n'* ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi

  if [[ -n "${expected_basename}" && "${path##*/}" != "${expected_basename}" ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi

  if ! /usr/bin/perl -MCwd=abs_path -MFcntl=:mode -e '
    alarm 5;
    my ($path, $trusted_parent, $expected_basename) = @ARGV;
    my $resolved_path = abs_path($path);
    my $resolved_parent = abs_path($trusted_parent);
    exit 1 unless defined $resolved_path && defined $resolved_parent;
    exit 1 unless $resolved_path eq $path && $resolved_parent eq $trusted_parent;
    exit 1 unless index($path, "$trusted_parent/") == 0;
    my $relative = substr($path, length($trusted_parent) + 1);
    my @parts = split m{/}, $relative, -1;
    exit 1 unless @parts && $parts[-1] eq $expected_basename;
    my $cursor = $trusted_parent;
    for my $part ("", @parts) {
      if (length $part) {
        exit 1 if $part eq "." || $part eq ".." || !length $part;
        $cursor .= "/$part";
      }
      my @details = lstat($cursor);
      exit 1 unless @details && S_ISDIR($details[2]);
      exit 1 unless $details[4] == $<;
      exit 1 unless (($details[2] & 0077) == 0);
    }
  ' "${path}" "${trusted_parent}" "${expected_basename}"; then
    budget_error 'unsafe Budget root' 66
    return
  fi

  printf '%s\n' "${path}"
}

budget_read_private_marker() {
  local marker="${1:-}"
  local status="${2:-67}"
  local unsafe_message="${3:-environment marker is unsafe}"

  if [[ -z "${marker}" || ( ! -e "${marker}" && ! -L "${marker}" ) ]]; then
    return 2
  fi
  if ! /usr/bin/perl -MFcntl=:DEFAULT,O_NOFOLLOW,:mode -e '
    alarm 5;
    my ($path) = @ARGV;
    my @before = lstat($path);
    exit 1 unless @before && S_ISREG($before[2]);
    exit 1 unless $before[4] == $< && (($before[2] & 0777) == 0600);
    exit 1 unless $before[7] <= 4096;
    sysopen(my $handle, $path, O_RDONLY | O_NOFOLLOW) or exit 1;
    my @opened = stat($handle);
    exit 1 unless @opened && $opened[0] == $before[0] && $opened[1] == $before[1];
    exit 1 unless S_ISREG($opened[2]);
    exit 1 unless $opened[4] == $< && (($opened[2] & 0777) == 0600);
    exit 1 unless $opened[7] <= 4096;
    local $/;
    my $contents = <$handle>;
    exit 1 unless defined $contents && length($contents) <= 4096;
    print $contents;
  ' "${marker}"; then
    budget_error "${unsafe_message}" "${status}"
    return
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

budget_require_private_artifact() {
  local path="${1:-}"
  local status="${2:-1}"
  if [[ -z "${path}" ]] || ! /usr/bin/perl -MFcntl=:DEFAULT,O_NOFOLLOW,:mode -e '
    alarm 5;
    my @before = lstat($ARGV[0]);
    exit 1 unless @before && S_ISREG($before[2]);
    exit 1 unless $before[4] == $< && (($before[2] & 0077) == 0) && $before[7] > 0;
    sysopen(my $handle, $ARGV[0], O_RDONLY | O_NOFOLLOW) or exit 1;
    my @opened = stat($handle);
    exit 1 unless @opened && S_ISREG($opened[2]);
    exit 1 unless $opened[0] == $before[0] && $opened[1] == $before[1];
  ' "${path}"; then
    budget_error 'generated recovery artifact is unsafe or empty' "${status}"
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
  local trusted_parent="${BUDGET_TRUSTED_PARENT:-}"
  local expected_project expected_port marker_contents canonical_root

  case "${environment}" in
    development|uat|live) ;;
    *)
      budget_error 'environment must be exactly development, uat, or live' 64
      return
      ;;
  esac

  for value in "${root}" "${marker}" "${project}" "${hostname}" "${volume}" \
    "${network}" "${port_range}" "${expected_system_id}" "${trusted_parent}"; do
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

  canonical_root="$(budget_validate_safe_path "${root}" "${project}" "${trusted_parent}")"
  if [[ "${marker}" != "${root}/.budget-ops-marker" ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi
  if [[ ! "${expected_system_id}" =~ ^[0-9]{10,22}$ ]]; then
    budget_error 'database system identifier must be an exact numeric value' 68
    return
  fi

  if [[ ! -e "${marker}" && ! -L "${marker}" ]]; then
    budget_error 'environment marker is missing' 67
    return
  fi
  marker_contents="$(budget_read_private_marker "${marker}" 67 'environment marker is unsafe')"
  if [[ "${marker_contents}" != "budget-ops-marker-v1
environment=${environment}
project=${project}
system_id=${expected_system_id}" ]]; then
    budget_error 'environment marker identity mismatch' 67
    return
  fi
  readonly BUDGET_VALIDATED_ENV="${environment}"
  readonly BUDGET_VALIDATED_ROOT="${canonical_root}"
  readonly BUDGET_VALIDATED_TRUSTED_PARENT="${trusted_parent}"
  readonly BUDGET_VALIDATED_PROJECT="${project}"
  readonly BUDGET_VALIDATED_SYSTEM_ID="${expected_system_id}"
  printf '%s\n' "validated Budget ${environment} target"
}

budget_revalidate_environment() {
  local marker_contents
  budget_validate_safe_path "${BUDGET_VALIDATED_ROOT}" "${BUDGET_VALIDATED_PROJECT}" \
    "${BUDGET_VALIDATED_TRUSTED_PARENT}" >/dev/null
  marker_contents="$(budget_read_private_marker "${BUDGET_MARKER_PATH}" 67 \
    'environment marker is unsafe')" || {
      if [[ $? -eq 2 ]]; then budget_error 'environment marker is missing' 67; fi
      return 67
    }
  if [[ "${marker_contents}" != "budget-ops-marker-v1
environment=${BUDGET_VALIDATED_ENV}
project=${BUDGET_VALIDATED_PROJECT}
system_id=${BUDGET_VALIDATED_SYSTEM_ID}" ]]; then
    budget_error 'environment marker identity mismatch' 67
  fi
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

    local assigned_value assignment_key approved_placeholder
    while IFS= read -r line; do
      if [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?(SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|DB_PASSWORD|SMTP_(PASSWORD|TOKEN)|AGE_IDENTITY|ADMIN_TOKEN)[[:space:]]*= ]]; then
        assignment_key="${BASH_REMATCH[2]}"
        assigned_value="${line#*=}"
        printf -v approved_placeholder '${%s:?required}' "${assignment_key}"
        if [[ ! "${assigned_value}" =~ ^[[:space:]]*$ && \
          "${assigned_value}" != "${approved_placeholder}" && \
          "${assigned_value}" != '<external-secret-reference>' ]]; then
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
