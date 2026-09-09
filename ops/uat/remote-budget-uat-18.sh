#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin'

readonly UAT_PROJECT='budget-uat-18'
readonly UAT_MARKER='.budget-uat-18-project'
readonly UAT_ROOT='/home/lelabo/budget-uat-18'

uat_remote_error() {
  printf '%s\n' "$1" >&2
  exit "${2:-70}"
}

require_exact_marker() {
  [[ -f "${UAT_ROOT}/${UAT_MARKER}" ]] || \
    uat_remote_error 'refusing operation without exact UAT marker' 67
  [[ "$(< "${UAT_ROOT}/${UAT_MARKER}")" == 'budget-uat-18-project-v1' ]] || \
    uat_remote_error 'refusing operation with mismatched UAT marker' 67
}

require_exact_project_labels() {
  local container_id project_label
  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    project_label="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "${container_id}")"
    [[ "${project_label}" == "${UAT_PROJECT}" ]] || \
      uat_remote_error 'refusing operation on a container with a foreign project label' 68
  done < <(docker ps -aq --filter "label=com.docker.compose.project=${UAT_PROJECT}")
}

refuse_until_lifecycle_is_verified() {
  uat_remote_error 'UAT lifecycle mechanics have not passed their behavior gate' 78
}

case "${1:-}" in
  preflight|sync|provision|verify|stop|cleanup)
    refuse_until_lifecycle_is_verified
    ;;
  *)
    uat_remote_error 'unknown remote UAT command' 64
    ;;
esac
