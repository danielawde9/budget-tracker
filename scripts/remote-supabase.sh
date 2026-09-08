#!/usr/bin/env bash
set -euo pipefail

readonly remote_host='lelabo@100.76.160.91'
readonly remote_dir='/home/lelabo/budget-supabase'
readonly remote_supabase='/home/lelabo/.local/bin/supabase'
readonly remote_marker='.budget-project'
readonly local_dir='supabase'
readonly project_id='budget-supabase'
readonly firewall_service='budget-tailnet-firewall.service'

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

ensure_tailnet_firewall() {
  if ! ssh "${remote_host}" "systemctl is-active --quiet '${firewall_service}'"; then
    printf '%s\n' "refusing to expose Budget without active ${firewall_service}" >&2
    exit 1
  fi
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
    ensure_tailnet_firewall
    sync_project
    ssh "${remote_host}" "cd '${remote_dir}' && '${remote_supabase}' start"
    disable_restart_policy
    ;;
  reset)
    ensure_tailnet_firewall
    sync_project
    ssh "${remote_host}" "cd '${remote_dir}' && '${remote_supabase}' db reset"
    disable_restart_policy
    ;;
  status)
    if [[ "${BUDGET_REMOTE_CHECK_ONLY:-}" == '1' ]]; then
      printf '%s\n' 'budget-supabase remote lifecycle configured'
    else
      ssh "${remote_host}" "cd '${remote_dir}' && '${remote_supabase}' status"
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
