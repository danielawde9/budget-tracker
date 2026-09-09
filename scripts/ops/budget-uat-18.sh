#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly UAT_RELEASE_HEAD='6af62c1b0105b75a9796cfb299791f4c26a7dd2e'
readonly UAT_REMOTE_HOST='lelabo@100.76.160.91'
readonly UAT_REMOTE_NAME='lelabo'
readonly UAT_REMOTE_IP='100.76.160.91'
readonly UAT_REMOTE_ROOT='/home/lelabo/budget-uat-18'
readonly UAT_PROJECT='budget-uat-18'
readonly UAT_MARKER='.budget-uat-18-project'
readonly UAT_MAX_HEALTH_POLLS=60
readonly UAT_HEALTH_POLL_SECONDS=5
readonly UAT_SSH_WALL_SECONDS=45
readonly UAT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly UAT_REPO_ROOT="$(cd "${UAT_SCRIPT_DIR}/../.." && pwd -P)"
readonly UAT_REMOTE_SCRIPT="${UAT_REPO_ROOT}/ops/uat/remote-budget-uat-18.sh"
readonly UAT_COMPOSE="${UAT_REPO_ROOT}/ops/uat/docker-compose.yml"
readonly UAT_KONG="${UAT_REPO_ROOT}/ops/uat/kong.yml"
readonly UAT_MANIFEST="${UAT_REPO_ROOT}/ops/uat/budget-uat-18-migrations.sha256"
readonly UAT_MIGRATIONS="${UAT_REPO_ROOT}/supabase/migrations"
readonly -a UAT_SSH_OPTIONS=(
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o ConnectionAttempts=2
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=2
)

uat_error() {
  printf '%s\n' "$1" >&2
  exit "${2:-70}"
}

bounded_exec() {
  /usr/bin/perl -e '$SIG{ALRM}=sub { exit 124 }; alarm shift @ARGV; exec @ARGV; exit 127;' \
    "${UAT_SSH_WALL_SECONDS}" "$@"
}

bounded_ssh() {
  bounded_exec ssh "${UAT_SSH_OPTIONS[@]}" "$@"
}

bounded_scp() {
  bounded_exec scp "${UAT_SSH_OPTIONS[@]}" "$@"
}

validate_local_release() {
  git -C "${UAT_REPO_ROOT}" merge-base --is-ancestor "${UAT_RELEASE_HEAD}" HEAD || \
    uat_error 'refusing UAT operation outside the approved release lineage' 64
  git -C "${UAT_REPO_ROOT}" diff --quiet "${UAT_RELEASE_HEAD}" -- supabase/migrations || \
    uat_error 'refusing UAT operation with changed release migrations' 64
  [[ -z "$(git -C "${UAT_REPO_ROOT}" ls-files --others --exclude-standard -- supabase/migrations)" ]] || \
    uat_error 'refusing UAT operation with untracked release migrations' 64
  [[ -f "${UAT_REMOTE_SCRIPT}" ]] || uat_error 'remote UAT helper is missing' 65
  validate_local_manifest
}

validate_cleanup_entrypoint() {
  [[ -f "${UAT_REMOTE_SCRIPT}" ]] || uat_error 'remote UAT helper is missing' 65
  [[ "$(id -u)" =~ ^[0-9]+$ ]] || uat_error 'local operator identity is unavailable' 65
}

validate_local_manifest() {
  local header source_row migration_count=0 previous_version='' version filename expected_hash actual_hash
  IFS= read -r header < "${UAT_MANIFEST}" || uat_error 'UAT manifest is unreadable' 66
  [[ "${header}" == 'budget_uat_migration_manifest_version=1' ]] || \
    uat_error 'UAT manifest header mismatch' 66
  source_row="$(sed -n '2p' "${UAT_MANIFEST}")"
  [[ "${source_row}" == "source_sha=${UAT_RELEASE_HEAD}" ]] || \
    uat_error 'UAT manifest release mismatch' 66
  while IFS='|' read -r version filename expected_hash; do
    [[ -n "${version}" ]] || continue
    [[ "${version}" =~ ^[0-9]{14}$ ]] || uat_error 'invalid UAT migration version' 66
    [[ "${filename}" =~ ^${version}_[a-z0-9_]+\.sql$ ]] || uat_error 'invalid UAT migration filename' 66
    [[ "${expected_hash}" =~ ^[a-f0-9]{64}$ ]] || uat_error 'invalid UAT migration hash' 66
    [[ -z "${previous_version}" || "${version}" > "${previous_version}" ]] || \
      uat_error 'UAT migration versions are not strictly increasing' 66
    [[ -f "${UAT_MIGRATIONS}/${filename}" ]] || uat_error 'UAT migration file is missing' 66
    actual_hash="$(shasum -a 256 "${UAT_MIGRATIONS}/${filename}")"
    actual_hash="${actual_hash%% *}"
    [[ "${actual_hash}" == "${expected_hash}" ]] || uat_error 'UAT migration hash mismatch' 66
    previous_version="${version}"
    migration_count=$((migration_count + 1))
  done < <(tail -n +3 "${UAT_MANIFEST}")
  [[ "${migration_count}" -eq 18 ]] || uat_error 'UAT manifest must contain exactly 18 migrations' 66
  [[ "$(find "${UAT_MIGRATIONS}" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')" -eq 18 ]] || \
    uat_error 'release migration directory must contain exactly 18 SQL files' 66
}

run_remote() {
  local command_name="${1:?command name is required}"
  bounded_ssh "${UAT_REMOTE_HOST}" \
    bash -s -- "${command_name}" < "${UAT_REMOTE_SCRIPT}"
}

sync_inputs() {
  local version filename expected_hash
  run_remote preflight
  run_remote sync
  bounded_scp "${UAT_COMPOSE}" "${UAT_REMOTE_HOST}:${UAT_REMOTE_ROOT}/docker-compose.yml"
  bounded_scp "${UAT_KONG}" "${UAT_REMOTE_HOST}:${UAT_REMOTE_ROOT}/kong.yml"
  bounded_scp "${UAT_MANIFEST}" "${UAT_REMOTE_HOST}:${UAT_REMOTE_ROOT}/budget-uat-18-migrations.sha256"
  while IFS='|' read -r version filename expected_hash; do
    [[ -n "${version}" ]] || continue
    bounded_scp "${UAT_MIGRATIONS}/${filename}" \
      "${UAT_REMOTE_HOST}:${UAT_REMOTE_ROOT}/migrations/${filename}"
  done < <(tail -n +3 "${UAT_MANIFEST}")
  run_remote verify-sync
}

case "${1:-}" in
  preflight)
    validate_local_release
    run_remote preflight
    ;;
  sync)
    validate_local_release
    sync_inputs
    ;;
  provision)
    validate_local_release
    run_remote preflight
    run_remote verify-sync
    run_remote provision
    ;;
  verify)
    validate_local_release
    run_remote verify
    ;;
  stop)
    validate_cleanup_entrypoint
    run_remote preflight
    run_remote stop
    ;;
  cleanup)
    validate_cleanup_entrypoint
    run_remote preflight
    run_remote cleanup
    ;;
  *)
    uat_error 'usage: budget-uat-18.sh {preflight|sync|provision|verify|stop|cleanup}' 64
    ;;
esac
