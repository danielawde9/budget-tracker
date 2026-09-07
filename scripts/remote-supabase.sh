#!/usr/bin/env bash
set -euo pipefail

readonly remote_host='daniel@100.124.228.75'
readonly remote_dir='/home/daniel/budget-supabase'
readonly remote_marker='.budget-project'
readonly local_dir='supabase'
readonly project_id='budget-supabase'

ensure_remote_directory() {
  ssh "${remote_host}" "
    if [ -e '${remote_dir}' ] && [ ! -f '${remote_dir}/${remote_marker}' ]; then
      printf '%s\\n' 'refusing to use unmarked remote directory: ${remote_dir}' >&2
      exit 1
    fi
    mkdir -p '${remote_dir}'
    : > '${remote_dir}/${remote_marker}'
  "
}

sync_project() {
  ensure_remote_directory
  scp -r "${local_dir}" "${remote_host}:${remote_dir}/"
}

disable_restart_policy() {
  ssh "${remote_host}" "
    docker ps -aq --filter 'name=${project_id}' |
      xargs -r docker update --restart=no >/dev/null
  "
}

case "${1:-}" in
  sync)
    sync_project
    ;;
  start)
    sync_project
    ssh "${remote_host}" "cd '${remote_dir}' && supabase start"
    disable_restart_policy
    ;;
  reset)
    sync_project
    ssh "${remote_host}" "cd '${remote_dir}' && supabase db reset"
    ;;
  status)
    if [[ "${BUDGET_REMOTE_CHECK_ONLY:-}" == '1' ]]; then
      printf '%s\n' 'budget-supabase remote lifecycle configured'
    else
      ssh "${remote_host}" "cd '${remote_dir}' && supabase status"
    fi
    ;;
  disable-restart)
    disable_restart_policy
    ;;
  *)
    printf '%s\n' 'usage: remote-supabase.sh {sync|start|reset|status|disable-restart}' >&2
    exit 64
    ;;
esac
