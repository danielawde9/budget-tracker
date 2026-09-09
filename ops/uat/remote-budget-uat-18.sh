#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin'

readonly UAT_PROJECT='budget-uat-18'
readonly UAT_MARKER='.budget-uat-18-project'
readonly UAT_ROOT='/home/lelabo/budget-uat-18'
readonly UAT_NETWORK='budget-uat-18-net'
readonly UAT_VOLUME='budget-uat-18-db-data'
readonly UAT_DB_CONTAINER='budget-uat-18-db'
readonly UAT_AUTH_CONTAINER='budget-uat-18-auth'
readonly UAT_REST_CONTAINER='budget-uat-18-rest'
readonly UAT_KONG_CONTAINER='budget-uat-18-kong'
readonly UAT_MANIFEST='budget-uat-18-migrations.sha256'
readonly UAT_MAX_HEALTH_POLLS=60
readonly UAT_HEALTH_POLL_SECONDS=5
readonly UAT_DOCKER_WALL_SECONDS=30
readonly UAT_MIN_FREE_KIB=20971520
readonly UAT_EXPECTED_RELEASE='6af62c1b0105b75a9796cfb299791f4c26a7dd2e'
readonly UAT_EXPECTED_DEV_SYSTEM_ID='7683090997378195493'
readonly UAT_EXPECTED_DEV_MIGRATION_COUNT='31'
readonly UAT_EXPECTED_DEV_LAST_MIGRATION='20260908180000'
readonly -a UAT_CONTAINERS=(
  "${UAT_DB_CONTAINER}"
  "${UAT_AUTH_CONTAINER}"
  "${UAT_REST_CONTAINER}"
  "${UAT_KONG_CONTAINER}"
)

uat_remote_error() {
  printf '%s\n' "$1" >&2
  exit "${2:-70}"
}

docker() {
  /usr/bin/timeout --signal=TERM "${UAT_DOCKER_WALL_SECONDS}" /usr/bin/docker "$@"
}

require_exact_marker() {
  local root_mode marker_mode
  [[ -d "${UAT_ROOT}" && ! -L "${UAT_ROOT}" ]] || uat_remote_error 'refusing operation without exact UAT root' 67
  [[ "$(readlink -f "${UAT_ROOT}")" == "${UAT_ROOT}" ]] || uat_remote_error 'refusing noncanonical UAT root' 67
  root_mode="$(stat -c '%a' "${UAT_ROOT}")"
  [[ "${root_mode}" == '700' ]] || uat_remote_error 'UAT root mode must be 0700' 67
  [[ -f "${UAT_ROOT}/${UAT_MARKER}" && ! -L "${UAT_ROOT}/${UAT_MARKER}" ]] || \
    uat_remote_error 'refusing operation without exact UAT marker' 67
  marker_mode="$(stat -c '%a' "${UAT_ROOT}/${UAT_MARKER}")"
  [[ "${marker_mode}" == '600' ]] || uat_remote_error 'UAT marker mode must be 0600' 67
  [[ "$(< "${UAT_ROOT}/${UAT_MARKER}")" == 'budget-uat-18-project-v1' ]] || \
    uat_remote_error 'refusing operation with mismatched UAT marker' 67
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

require_exact_project_labels() {
  local container_name project_label
  for container_name in "${UAT_CONTAINERS[@]}"; do
    container_exists "${container_name}" || continue
    project_label="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "${container_name}")"
    [[ "${project_label}" == "${UAT_PROJECT}" ]] || \
      uat_remote_error 'refusing operation on a container with a foreign project label' 68
  done
}

reject_unknown_uat_resources() {
  local container_id resource_name
  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    resource_name="$(docker inspect --format '{{.Name}}' "${container_id}")"
    resource_name="${resource_name#/}"
    case "${resource_name}" in
      "${UAT_DB_CONTAINER}"|"${UAT_AUTH_CONTAINER}"|"${UAT_REST_CONTAINER}"|"${UAT_KONG_CONTAINER}") ;;
      *) uat_remote_error 'refusing unknown UAT container collision' 68 ;;
    esac
  done < <(docker ps -aq --filter "name=${UAT_PROJECT}")
  while IFS= read -r resource_name; do
    [[ -z "${resource_name}" || "${resource_name}" == "${UAT_NETWORK}" ]] || \
      uat_remote_error 'refusing unknown UAT network collision' 68
  done < <(docker network ls --format '{{.Name}}' | grep -E "^${UAT_PROJECT}" || true)
  while IFS= read -r resource_name; do
    [[ -z "${resource_name}" || "${resource_name}" == "${UAT_VOLUME}" ]] || \
      uat_remote_error 'refusing unknown UAT volume collision' 68
  done < <(docker volume ls --format '{{.Name}}' | grep -E "^${UAT_PROJECT}" || true)
}

require_exact_network_or_absent() {
  local project_label
  docker network inspect "${UAT_NETWORK}" >/dev/null 2>&1 || return 0
  project_label="$(docker network inspect "${UAT_NETWORK}" | jq -r '.[0].Labels["com.docker.compose.project"] // ""')"
  [[ "${project_label}" == "${UAT_PROJECT}" ]] || uat_remote_error 'refusing foreign UAT network collision' 68
}

require_exact_volume_or_absent() {
  local project_label
  docker volume inspect "${UAT_VOLUME}" >/dev/null 2>&1 || return 0
  project_label="$(docker volume inspect "${UAT_VOLUME}" | jq -r '.[0].Labels["com.docker.compose.project"] // ""')"
  [[ "${project_label}" == "${UAT_PROJECT}" ]] || uat_remote_error 'refusing foreign UAT volume collision' 68
}

port_is_owned_by_uat() {
  local port="$1" container_name published
  for container_name in "${UAT_CONTAINERS[@]}"; do
    container_exists "${container_name}" || continue
    published="$(docker port "${container_name}" 2>/dev/null || true)"
    [[ "${published}" == *"127.0.0.1:${port}"* ]] && return 0
  done
  return 1
}

require_candidate_ports() {
  local port
  for port in 54521 54522; do
    if ss -H -lnt "sport = :${port}" | grep -q . && ! port_is_owned_by_uat "${port}"; then
      uat_remote_error 'refusing occupied UAT port' 69
    fi
  done
}

snapshot_budget_development() {
  local container_id db_id
  local -a dev_ids db_ids
  mapfile -t dev_ids < <(docker ps -aq --filter 'label=com.docker.compose.project=budget-supabase')
  [[ "${#dev_ids[@]}" -eq 12 ]] || uat_remote_error 'Budget development container count changed' 72
  for container_id in "${dev_ids[@]}"; do
    docker inspect "${container_id}" | jq -r '.[0] | "container|\(.Name)|\(.Id)|restart=\(.RestartCount)|policy=\(.HostConfig.RestartPolicy.Name)|running=\(.State.Running)|health=\(.State.Health.Status // "none")"'
  done | LC_ALL=C sort
  mapfile -t db_ids < <(docker ps -q --filter 'label=com.docker.compose.project=budget-supabase' --filter 'name=supabase_db_')
  [[ "${#db_ids[@]}" -eq 1 ]] || uat_remote_error 'Budget development database identity is ambiguous' 72
  db_id="${db_ids[0]}"
  docker exec "${db_id}" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "select 'database|' || system_identifier || '|version=' || current_setting('server_version_num') from pg_control_system();"
  docker exec "${db_id}" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "select 'journal|' || count(*) || '|last=' || max(version) || '|versions=' || string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;"
}

compare_budget_development_snapshots() {
  local before="$1" after="$2"
  [[ "${before}" == "${after}" ]] || uat_remote_error 'Budget development state changed during UAT operation' 73
  [[ "${after}" == *"database|${UAT_EXPECTED_DEV_SYSTEM_ID}|version=170006"* ]] || \
    uat_remote_error 'Budget development database identity mismatch' 73
  [[ "${after}" == *"journal|${UAT_EXPECTED_DEV_MIGRATION_COUNT}|last=${UAT_EXPECTED_DEV_LAST_MIGRATION}"* ]] || \
    uat_remote_error 'Budget development migration journal mismatch' 73
}

host_preflight() {
  local available_kib
  [[ "$(hostname)" == 'lelabo' ]] || uat_remote_error 'approved hostname mismatch' 71
  [[ "$(/usr/bin/timeout --signal=TERM 15 tailscale ip -4 | head -n 1)" == '100.76.160.91' ]] || uat_remote_error 'approved Tailscale address mismatch' 71
  available_kib="$(df -Pk /home/lelabo | awk 'NR==2 {print $4}')"
  [[ "${available_kib}" =~ ^[0-9]+$ && "${available_kib}" -ge "${UAT_MIN_FREE_KIB}" ]] || \
    uat_remote_error 'insufficient UAT disk capacity' 71
  if [[ -e "${UAT_ROOT}" ]]; then
    require_exact_marker
  fi
  reject_unknown_uat_resources
  require_exact_project_labels
  require_exact_network_or_absent
  require_exact_volume_or_absent
  require_candidate_ports
}

prepare_sync_root() {
  if [[ ! -e "${UAT_ROOT}" ]]; then
    mkdir -m 0700 "${UAT_ROOT}"
    (set -o noclobber; printf '%s' 'budget-uat-18-project-v1' > "${UAT_ROOT}/${UAT_MARKER}")
    chmod 0600 "${UAT_ROOT}/${UAT_MARKER}"
  fi
  require_exact_marker
  mkdir -p -m 0700 "${UAT_ROOT}/migrations"
  chmod 0700 "${UAT_ROOT}/migrations"
  printf '%s\n' '.env' > "${UAT_ROOT}/.gitignore"
  chmod 0600 "${UAT_ROOT}/.gitignore"
}

verify_migration_bundle() {
  local input header source_row migration_count=0 previous_version='' version filename expected_hash actual_hash
  require_exact_marker
  for input in docker-compose.yml kong.yml "${UAT_MANIFEST}"; do
    [[ -f "${UAT_ROOT}/${input}" && ! -L "${UAT_ROOT}/${input}" ]] || uat_remote_error 'required UAT input is missing or unsafe' 74
    chmod 0600 "${UAT_ROOT}/${input}"
  done
  IFS= read -r header < "${UAT_ROOT}/${UAT_MANIFEST}"
  [[ "${header}" == 'budget_uat_migration_manifest_version=1' ]] || uat_remote_error 'remote UAT manifest header mismatch' 74
  source_row="$(sed -n '2p' "${UAT_ROOT}/${UAT_MANIFEST}")"
  [[ "${source_row}" == "source_sha=${UAT_EXPECTED_RELEASE}" ]] || uat_remote_error 'remote UAT release mismatch' 74
  while IFS='|' read -r version filename expected_hash; do
    [[ -n "${version}" ]] || continue
    [[ "${version}" =~ ^[0-9]{14}$ && "${filename}" =~ ^${version}_[a-z0-9_]+\.sql$ && "${expected_hash}" =~ ^[a-f0-9]{64}$ ]] || uat_remote_error 'invalid remote UAT migration row' 74
    [[ -z "${previous_version}" || "${version}" > "${previous_version}" ]] || uat_remote_error 'remote UAT migration order mismatch' 74
    [[ -f "${UAT_ROOT}/migrations/${filename}" && ! -L "${UAT_ROOT}/migrations/${filename}" ]] || uat_remote_error 'remote UAT migration is missing or unsafe' 74
    chmod 0600 "${UAT_ROOT}/migrations/${filename}"
    actual_hash="$(sha256sum "${UAT_ROOT}/migrations/${filename}")"
    actual_hash="${actual_hash%% *}"
    [[ "${actual_hash}" == "${expected_hash}" ]] || uat_remote_error 'remote UAT migration hash mismatch' 74
    previous_version="${version}"
    migration_count=$((migration_count + 1))
  done < <(tail -n +3 "${UAT_ROOT}/${UAT_MANIFEST}")
  [[ "${migration_count}" -eq 18 ]] || uat_remote_error 'remote UAT manifest must contain 18 rows' 74
  [[ "$(find "${UAT_ROOT}/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l)" -eq 18 ]] || uat_remote_error 'remote UAT migration directory must contain 18 SQL files' 74
  printf 'MIGRATION_BUNDLE|count=18|source=%s|hash_mismatches=0\n' "${UAT_EXPECTED_RELEASE}"
}

generate_secret_environment() {
  [[ ! -e "${UAT_ROOT}/.env" ]] || uat_remote_error 'refusing to reuse a UAT secret environment' 75
  python3 - "${UAT_ROOT}/.env" <<'PY'
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time

path = sys.argv[1]
descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)

def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")

def jwt(secret: str, role: str) -> str:
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(json.dumps({"aud": "authenticated", "exp": now + 157680000, "iat": now, "iss": "supabase", "ref": "budget-uat-18", "role": role}, separators=(",", ":"), sort_keys=True).encode())
    signing_input = f"{header}.{payload}"
    signature = b64(hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"

jwt_secret = secrets.token_urlsafe(48)
values = {
    "POSTGRES_PASSWORD": secrets.token_urlsafe(36),
    "JWT_SECRET": jwt_secret,
    "ANON_KEY": jwt(jwt_secret, "anon"),
    "SERVICE_ROLE_KEY": jwt(jwt_secret, "service_role"),
    "API_EXTERNAL_URL": "https://lelabo-ubuntu-server.tail944994.ts.net:54521/auth/v1",
    "SITE_URL": "https://lelabo-ubuntu-server.tail944994.ts.net:54521",
    "GOTRUE_PASSWORD_MIN_LENGTH": "12",
    "JWT_EXPIRY": "3600",
}
with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
    for name, value in values.items():
        output.write(f"{name}={value}\n")
PY
  [[ "$(stat -c '%a' "${UAT_ROOT}/.env")" == '600' ]] || uat_remote_error 'UAT secret environment mode mismatch' 75
}

compose() {
  (cd "${UAT_ROOT}" && docker compose --project-name "${UAT_PROJECT}" --env-file .env -f docker-compose.yml "$@")
}

wait_for_health() {
  local poll container_name state health all_healthy
  for ((poll = 1; poll <= UAT_MAX_HEALTH_POLLS; poll += 1)); do
    all_healthy='yes'
    for container_name in "${UAT_CONTAINERS[@]}"; do
      if ! container_exists "${container_name}"; then
        all_healthy='no'
        break
      fi
      state="$(docker inspect --format '{{.State.Status}}' "${container_name}")"
      health="$(docker inspect "${container_name}" | jq -r '.[0].State.Health.Status // "none"')"
      if [[ "${state}" != 'running' || "${health}" != 'healthy' ]]; then
        all_healthy='no'
        break
      fi
    done
    [[ "${all_healthy}" == 'yes' ]] && return 0
    sleep "${UAT_HEALTH_POLL_SECONDS}"
  done
  uat_remote_error 'UAT containers did not become healthy within 300 seconds' 76
}

ensure_empty_migration_journal() {
  local migration_count
  docker exec "${UAT_DB_CONTAINER}" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    'create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);' >/dev/null
  migration_count="$(docker exec "${UAT_DB_CONTAINER}" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'select count(*) from supabase_migrations.schema_migrations;')"
  [[ "${migration_count}" == '0' ]] || uat_remote_error 'UAT migration journal is not empty' 77
}

apply_migrations() {
  local version filename expected_hash
  while IFS='|' read -r version filename expected_hash; do
    [[ -n "${version}" ]] || continue
    {
      printf '%s\n' 'begin;'
      /bin/cat "${UAT_ROOT}/migrations/${filename}"
      printf "insert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "${version}" "${filename%.sql}"
      printf '%s\n' 'commit;'
    } | docker exec -i "${UAT_DB_CONTAINER}" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
  done < <(tail -n +3 "${UAT_ROOT}/${UAT_MANIFEST}")
}

verify_journal() {
  local actual expected
  actual="$(docker exec "${UAT_DB_CONTAINER}" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'select version from supabase_migrations.schema_migrations order by version;')"
  expected="$(tail -n +3 "${UAT_ROOT}/${UAT_MANIFEST}" | cut -d '|' -f 1)"
  [[ "${actual}" == "${expected}" ]] || uat_remote_error 'UAT migration journal differs from manifest' 77
  printf 'UAT_JOURNAL|count=18|first=%s|last=%s\n' "${actual%%$'\n'*}" "${actual##*$'\n'}"
}

verify_stack_base() {
  local container_name policy port_binding system_id server_version
  require_exact_marker
  require_exact_project_labels
  require_exact_network_or_absent
  require_exact_volume_or_absent
  wait_for_health
  for container_name in "${UAT_CONTAINERS[@]}"; do
    policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${container_name}")"
    [[ "${policy}" == 'no' ]] || uat_remote_error 'UAT restart policy mismatch' 78
  done
  port_binding="$(docker port "${UAT_KONG_CONTAINER}" 8000/tcp)"
  [[ "${port_binding}" == '127.0.0.1:54521' ]] || uat_remote_error 'UAT gateway binding mismatch' 78
  port_binding="$(docker port "${UAT_DB_CONTAINER}" 5432/tcp)"
  [[ "${port_binding}" == '127.0.0.1:54522' ]] || uat_remote_error 'UAT database binding mismatch' 78
  system_id="$(docker exec "${UAT_DB_CONTAINER}" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'select system_identifier from pg_control_system();')"
  server_version="$(docker exec "${UAT_DB_CONTAINER}" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c "select current_setting('server_version_num');")"
  [[ "${system_id}" =~ ^[0-9]+$ && "${system_id}" != "${UAT_EXPECTED_DEV_SYSTEM_ID}" ]] || uat_remote_error 'UAT database system identifier is not isolated' 78
  [[ "${server_version}" == '170006' ]] || uat_remote_error 'UAT PostgreSQL version mismatch' 78
  verify_migration_bundle >/dev/null
  verify_journal
  printf 'UAT_DATABASE|version=%s|system_id=%s\n' "${server_version}" "${system_id}"
  printf 'UAT_CONTAINERS|count=4|healthy=4|restart_policy=no\n'
  printf 'UAT_BINDINGS|gateway=127.0.0.1:54521|database=127.0.0.1:54522\n'
}

provision_stack() {
  local before after
  host_preflight
  verify_migration_bundle >/dev/null
  before="$(snapshot_budget_development)"
  generate_secret_environment
  compose up -d
  wait_for_health
  ensure_empty_migration_journal
  apply_migrations
  verify_stack_base
  after="$(snapshot_budget_development)"
  compare_budget_development_snapshots "${before}" "${after}"
  printf '%s\n' 'BUDGET_DEV_NONINTERFERENCE|unchanged=yes'
}

stop_stack() {
  require_exact_marker
  require_exact_project_labels
  compose stop
}

remove_exact_root() {
  python3 - "${UAT_ROOT}" "${UAT_MARKER}" <<'PY'
import os
import re
import stat
import sys

root, marker = sys.argv[1:]
details = os.lstat(root)
if not stat.S_ISDIR(details.st_mode) or details.st_uid != os.geteuid() or details.st_mode & 0o077:
    raise SystemExit("unsafe UAT root")
if os.path.realpath(root) != root:
    raise SystemExit("noncanonical UAT root")
allowed = {marker, ".env", ".gitignore", "docker-compose.yml", "kong.yml", "budget-uat-18-migrations.sha256", "migrations"}
entries = os.listdir(root)
if len(entries) > len(allowed) or any(entry not in allowed for entry in entries):
    raise SystemExit("unexpected UAT root entry")
migrations = os.path.join(root, "migrations")
if os.path.isdir(migrations):
    names = os.listdir(migrations)
    if len(names) != 18 or any(re.fullmatch(r"[0-9]{14}_[a-z0-9_]+\.sql", name) is None for name in names):
        raise SystemExit("unexpected UAT migration entry")
    for name in names:
        path = os.path.join(migrations, name)
        if not stat.S_ISREG(os.lstat(path).st_mode):
            raise SystemExit("unsafe UAT migration entry")
        os.unlink(path)
    os.rmdir(migrations)
for entry in [marker, ".env", ".gitignore", "docker-compose.yml", "kong.yml", "budget-uat-18-migrations.sha256"]:
    path = os.path.join(root, entry)
    if os.path.exists(path):
        if not stat.S_ISREG(os.lstat(path).st_mode):
            raise SystemExit("unsafe UAT file")
        os.unlink(path)
os.rmdir(root)
PY
}

cleanup_stack() {
  local before after project_label
  require_exact_marker
  require_exact_project_labels
  require_exact_volume_or_absent
  require_exact_network_or_absent
  before="$(snapshot_budget_development)"
  compose down
  if docker volume inspect "${UAT_VOLUME}" >/dev/null 2>&1; then
    project_label="$(docker volume inspect "${UAT_VOLUME}" | jq -r '.[0].Labels["com.docker.compose.project"] // ""')"
    [[ "${project_label}" == "${UAT_PROJECT}" ]] || uat_remote_error 'refusing foreign UAT volume cleanup' 79
    docker volume rm "${UAT_VOLUME}"
  fi
  if docker network inspect "${UAT_NETWORK}" >/dev/null 2>&1; then
    project_label="$(docker network inspect "${UAT_NETWORK}" | jq -r '.[0].Labels["com.docker.compose.project"] // ""')"
    [[ "${project_label}" == "${UAT_PROJECT}" ]] || uat_remote_error 'refusing foreign UAT network cleanup' 79
    docker network rm "${UAT_NETWORK}"
  fi
  remove_exact_root
  after="$(snapshot_budget_development)"
  compare_budget_development_snapshots "${before}" "${after}"
  printf '%s\n' 'UAT_CLEANUP|removed=containers,network,volume,root|budget_dev_unchanged=yes'
}

case "${1:-}" in
  preflight)
    host_preflight
    snapshot_budget_development
    ;;
  sync)
    host_preflight
    prepare_sync_root
    ;;
  verify-sync)
    verify_migration_bundle
    ;;
  provision)
    provision_stack
    ;;
  verify)
    host_preflight
    verify_stack_base
    ;;
  stop)
    host_preflight
    stop_stack
    ;;
  cleanup)
    host_preflight
    cleanup_stack
    ;;
  *)
    uat_remote_error 'unknown remote UAT command' 64
    ;;
esac
