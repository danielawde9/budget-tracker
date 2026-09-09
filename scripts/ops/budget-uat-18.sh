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
readonly UAT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly UAT_REPO_ROOT="$(cd "${UAT_SCRIPT_DIR}/../.." && pwd -P)"
readonly UAT_REMOTE_SCRIPT="${UAT_REPO_ROOT}/ops/uat/remote-budget-uat-18.sh"
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

validate_local_release() {
  git -C "${UAT_REPO_ROOT}" merge-base --is-ancestor "${UAT_RELEASE_HEAD}" HEAD || \
    uat_error 'refusing UAT operation outside the approved release lineage' 64
  git -C "${UAT_REPO_ROOT}" diff --quiet "${UAT_RELEASE_HEAD}" -- supabase/migrations || \
    uat_error 'refusing UAT operation with changed release migrations' 64
  [[ -z "$(git -C "${UAT_REPO_ROOT}" ls-files --others --exclude-standard -- supabase/migrations)" ]] || \
    uat_error 'refusing UAT operation with untracked release migrations' 64
  [[ -f "${UAT_REMOTE_SCRIPT}" ]] || uat_error 'remote UAT helper is missing' 65
}

run_remote() {
  local command_name="${1:?command name is required}"
  ssh "${UAT_SSH_OPTIONS[@]}" "${UAT_REMOTE_HOST}" \
    bash -s -- "${command_name}" < "${UAT_REMOTE_SCRIPT}"
}

validate_local_release

case "${1:-}" in
  preflight)
    run_remote preflight
    ;;
  sync)
    run_remote sync
    ;;
  provision)
    run_remote provision
    ;;
  verify)
    run_remote verify
    ;;
  stop)
    run_remote stop
    ;;
  cleanup)
    run_remote cleanup
    ;;
  *)
    uat_error 'usage: budget-uat-18.sh {preflight|sync|provision|verify|stop|cleanup}' 64
    ;;
esac
