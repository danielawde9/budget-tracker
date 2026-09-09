#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly MIGRATE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./budget-common.sh
source "${MIGRATE_SCRIPT_DIR}/budget-common.sh"

readonly MIGRATION_MAX_FILES=256
readonly MIGRATION_HASH_TIMEOUT_SECONDS=60
readonly MIGRATION_SHA256_BIN='/usr/bin/shasum'
readonly MIGRATION_PERL_BIN='/usr/bin/perl'

MIGRATION_VERSIONS=()
MIGRATION_FILENAMES=()
MIGRATION_HASHES=()
EXPECTED_VERSIONS=()
EXPECTED_FILENAMES=()
EXPECTED_HASHES=()
EXPECTED_SOURCE_SHA=''

migration_bounded_run() {
  if [[ -n "${BUDGET_TIMEOUT_BIN:-}" ]]; then
    "${BUDGET_TIMEOUT_BIN}" "${MIGRATION_HASH_TIMEOUT_SECONDS}" "$@"
  else
    "${MIGRATION_PERL_BIN}" -e 'alarm shift @ARGV; exec @ARGV or die "exec failed\n"' \
      "${MIGRATION_HASH_TIMEOUT_SECONDS}" "$@"
  fi
}

migration_validate_source_sha() {
  local source_sha="${1:-}"
  if [[ ! "${source_sha}" =~ ^[a-f0-9]{40}([a-f0-9]{24})?$ ]]; then
    budget_error 'source SHA must be an exact 40- or 64-character lowercase hash' 79
  fi
}

migration_validate_input_path() {
  local path="${1:-}"
  if [[ -z "${path}" || "${path}" != /* || "${path}" == '/' || \
    "${path}" == "${HOME:-__unset_home__}" || "${path}" == "${BUDGET_OPS_REPO_ROOT}" || \
    "${path}" == *'$'* || "${path}" == *'{'* || "${path}" == *'}'* || \
    "${path}" == *'*'* || "${path}" == *'?'* || "${path}" == *'['* || \
    "${path}" == *'/../'* || "${path}" == */.. ]]; then
    budget_error 'migration path is unresolved or overly broad' 79
    return
  fi
  if budget_is_protected_identifier "${path}"; then
    budget_error 'migration path contains a protected Sandooq/POS identifier' 79
  fi
}

migration_hash() {
  local path="${1:?migration path is required}"
  local output
  output="$(migration_bounded_run "${MIGRATION_SHA256_BIN}" -a 256 "${path}")"
  printf '%s\n' "${output%% *}"
}

migration_find_version() {
  local needle="${1:?migration version is required}"
  shift
  local candidate position=0
  for candidate in "$@"; do
    if [[ "${candidate}" == "${needle}" ]]; then
      printf '%s\n' "${position}"
      return 0
    fi
    position=$((position + 1))
  done
  return 1
}

migration_find_filename() {
  local needle="${1:?migration filename is required}"
  shift
  local candidate position=0
  for candidate in "$@"; do
    if [[ "${candidate}" == "${needle}" ]]; then
      printf '%s\n' "${position}"
      return 0
    fi
    position=$((position + 1))
  done
  return 1
}

migration_collect_files() {
  local directory="${1:?migration directory is required}"
  migration_validate_input_path "${directory}"
  if [[ ! -d "${directory}" ]]; then
    budget_error 'migration directory does not exist' 79
    return
  fi

  MIGRATION_VERSIONS=()
  MIGRATION_FILENAMES=()
  MIGRATION_HASHES=()
  local path filename version existing count=0
  shopt -s nullglob
  for path in "${directory}"/*.sql; do
    count=$((count + 1))
    if (( count > MIGRATION_MAX_FILES )); then
      budget_error 'migration journal exceeds 256 files' 79
      return
    fi
    filename="${path##*/}"
    if [[ ! "${filename}" =~ ^([0-9]{14})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$ ]]; then
      budget_error 'migration filename is outside the exact allowlist' 79
      return
    fi
    version="${BASH_REMATCH[1]}"
    if (( ${#MIGRATION_VERSIONS[@]} > 0 )); then
      for existing in "${MIGRATION_VERSIONS[@]}"; do
        if [[ "${existing}" == "${version}" ]]; then
          budget_error 'duplicate migration version' 79
          return
        fi
      done
    fi
    MIGRATION_VERSIONS+=("${version}")
    MIGRATION_FILENAMES+=("${filename}")
    MIGRATION_HASHES+=("$(migration_hash "${path}")")
  done
  shopt -u nullglob
  if (( count == 0 )); then
    budget_error 'migration journal is empty' 79
  fi
}

migration_read_expected() {
  local manifest="${1:?expected manifest is required}"
  migration_validate_input_path "${manifest}"
  if [[ ! -f "${manifest}" ]]; then
    budget_error 'expected migration manifest is missing' 79
    return
  fi

  EXPECTED_VERSIONS=()
  EXPECTED_FILENAMES=()
  EXPECTED_HASHES=()
  EXPECTED_SOURCE_SHA=''
  local line line_number=0 version filename hash extra existing count=0
  while IFS= read -r line; do
    line_number=$((line_number + 1))
    if (( line_number == 1 )); then
      [[ "${line}" == 'budget_migration_manifest_version=1' ]] || {
        budget_error 'migration manifest version is invalid' 79; return; }
      continue
    fi
    if (( line_number == 2 )); then
      [[ "${line}" == source_sha=* ]] || {
        budget_error 'migration manifest source SHA is missing' 79; return; }
      EXPECTED_SOURCE_SHA="${line#source_sha=}"
      migration_validate_source_sha "${EXPECTED_SOURCE_SHA}"
      continue
    fi
    [[ -z "${line}" ]] && continue
    IFS='|' read -r version filename hash extra <<< "${line}"
    if [[ ! "${version}" =~ ^[0-9]{14}$ || \
      "${filename}" != "${version}_"*.sql || \
      ! "${hash}" =~ ^[a-f0-9]{64}$ || -n "${extra}" ]]; then
      budget_error 'migration manifest row is invalid' 79
      return
    fi
    count=$((count + 1))
    if (( count > MIGRATION_MAX_FILES )); then
      budget_error 'migration manifest exceeds 256 files' 79
      return
    fi
    if (( ${#EXPECTED_VERSIONS[@]} > 0 )); then
      for existing in "${EXPECTED_VERSIONS[@]}"; do
        if [[ "${existing}" == "${version}" ]]; then
          budget_error 'duplicate migration version in manifest' 79
          return
        fi
      done
    fi
    EXPECTED_VERSIONS+=("${version}")
    EXPECTED_FILENAMES+=("${filename}")
    EXPECTED_HASHES+=("${hash}")
  done < "${manifest}"
  if (( count == 0 )); then
    budget_error 'migration manifest has no migration rows' 79
  fi
}

migration_create_manifest() {
  local directory="${1:-}" output="${2:-}" source_sha="${3:-}"
  migration_validate_source_sha "${source_sha}"
  migration_validate_input_path "${output}"
  migration_collect_files "${directory}"

  local output_parent="${output%/*}"
  local lock="${output}.lock"
  local temporary="${output}.tmp"
  if [[ ! -d "${output_parent}" ]]; then
    budget_error 'migration manifest parent directory is missing' 79
    return
  fi
  if [[ -e "${output}" || -e "${temporary}" ]]; then
    budget_error 'migration manifest output already exists' 79
    return
  fi
  if ! mkdir -- "${lock}" 2>/dev/null; then
    budget_error 'migration manifest creation is already running' 79
    return
  fi
  trap 'rm -f -- "${temporary}"; rmdir -- "${lock}" 2>/dev/null || true' EXIT INT TERM HUP

  {
    printf '%s\n' 'budget_migration_manifest_version=1'
    printf 'source_sha=%s\n' "${source_sha}"
    local position
    for ((position = 0; position < ${#MIGRATION_VERSIONS[@]}; position += 1)); do
      printf '%s|%s|%s\n' "${MIGRATION_VERSIONS[position]}" \
        "${MIGRATION_FILENAMES[position]}" "${MIGRATION_HASHES[position]}"
    done
  } > "${temporary}"
  mv -- "${temporary}" "${output}"
  rmdir -- "${lock}"
  trap - EXIT INT TERM HUP
  printf 'created migration manifest with %s files\n' "${#MIGRATION_VERSIONS[@]}"
}

migration_verify_applied() {
  local applied="${1:?applied migration rows file is required}"
  migration_validate_input_path "${applied}"
  if [[ ! -f "${applied}" ]]; then
    budget_error 'applied migration rows file is missing' 79
    return
  fi
  local -a applied_versions=()
  local version existing count=0
  while IFS= read -r version; do
    [[ -z "${version}" ]] && continue
    count=$((count + 1))
    if (( count > MIGRATION_MAX_FILES )) || [[ ! "${version}" =~ ^[0-9]{14}$ ]]; then
      budget_error 'applied migration row is invalid or unbounded' 79
      return
    fi
    if (( ${#applied_versions[@]} > 0 )); then
      for existing in "${applied_versions[@]}"; do
        if [[ "${existing}" == "${version}" ]]; then
          budget_error 'duplicate applied migration row' 79
          return
        fi
      done
    fi
    if ! migration_find_version "${version}" "${EXPECTED_VERSIONS[@]}" >/dev/null; then
      budget_error 'unknown applied migration row' 79
      return
    fi
    applied_versions+=("${version}")
  done < "${applied}"
  printf '%s\n' "${count}"
}

migration_verify_manifest() {
  local directory="${1:-}" expected="${2:-}" applied="${3:-}" actual_source_sha="${4:-}"
  migration_read_expected "${expected}"
  migration_validate_source_sha "${actual_source_sha}"
  if [[ "${actual_source_sha}" != "${EXPECTED_SOURCE_SHA}" ]]; then
    budget_error 'source SHA mismatch' 79
    return
  fi

  migration_collect_files "${directory}"
  local position expected_position
  for ((position = 0; position < ${#EXPECTED_FILENAMES[@]}; position += 1)); do
    expected_position="$(migration_find_filename "${EXPECTED_FILENAMES[position]}" \
      "${MIGRATION_FILENAMES[@]}")" || {
        budget_error 'missing migration file' 79; return; }
    if [[ "${MIGRATION_HASHES[expected_position]}" != "${EXPECTED_HASHES[position]}" ]]; then
      budget_error 'changed migration file' 79
      return
    fi
  done
  for ((position = 0; position < ${#MIGRATION_FILENAMES[@]}; position += 1)); do
    if ! migration_find_filename "${MIGRATION_FILENAMES[position]}" \
      "${EXPECTED_FILENAMES[@]}" >/dev/null; then
      budget_error 'unmanifested migration file' 79
      return
    fi
  done

  local applied_count
  applied_count="$(migration_verify_applied "${applied}")"
  printf 'verified %s migration files and %s applied rows\n' \
    "${#MIGRATION_FILENAMES[@]}" "${applied_count}"
}

case "${1:-}" in
  create-manifest) migration_create_manifest "${2:-}" "${3:-}" "${4:-}" ;;
  verify-manifest) migration_verify_manifest "${2:-}" "${3:-}" "${4:-}" "${5:-}" ;;
  *) budget_error 'usage: migrate-budget.sh {create-manifest DIR OUTPUT SOURCE_SHA|verify-manifest DIR EXPECTED APPLIED ACTUAL_SOURCE_SHA}' 64 ;;
esac
