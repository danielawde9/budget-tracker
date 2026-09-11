#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly RESTORE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./budget-common.sh
source "${RESTORE_SCRIPT_DIR}/budget-common.sh"

# Scratch restore of Supabase CLI dumps into one labelled supabase/postgres
# container. Every database command runs through `docker exec` inside that
# container; this script never connects to a hosted project. See
# docs/operations/backup-restore-runbook.md for the procedure and its limits.

readonly RESTORE_SQL_DIR="${BUDGET_OPS_REPO_ROOT}/ops/supabase-restore"
readonly RESTORE_LABEL_KEY='budget.restore-target'
readonly RESTORE_LABEL_VALUE='supabase-scratch'
readonly RESTORE_IMAGE_TAG='17.6.1.166'
readonly RESTORE_IMAGE_DIGEST='sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86'
readonly RESTORE_MAX_DUMP_BYTES=536870912
readonly RESTORE_MAX_SMALL_BYTES=16777216
readonly RESTORE_MAX_REPORT_LINES=50
readonly RESTORE_OPERATION_SECONDS=1800
readonly RESTORE_FINGERPRINT_HEADER='budget-supabase-fingerprint-v1'
readonly RESTORE_VERSIONS_FILE='auth-schema-migrations.txt'
readonly -a RESTORE_DUMP_FILES=(
  roles.sql
  auth-schema.sql
  supabase-migrations-schema.sql
  schema.sql
  data.sql
  migration-history.sql
)
# Platform roles with a reviewed definition in ops/supabase-restore.
readonly -a RESTORE_PLATFORM_ROLES=(supabase_realtime_admin)

readonly EXIT_USAGE=64
readonly EXIT_INPUT=65
readonly EXIT_TARGET=66
readonly EXIT_DATABASE=67
readonly EXIT_VERIFICATION=68

# Copies COPY data verbatim, drops a storage COPY block only when it is empty,
# and refuses psql meta-commands, transaction control, storage rows, and an
# unterminated COPY block anywhere else in a dump.
readonly RESTORE_DUMP_FILTER='
  function refuse(code) { failure = code; exit code }
  in_copy {
    if ($0 == "\\.") {
      in_copy = 0
      if (storage_copy) { storage_copy = 0; next }
      print
      next
    }
    if (storage_copy) refuse(12)
    print
    next
  }
  /^COPY .* FROM stdin;$/ {
    in_copy = 1
    if ($0 ~ /^COPY "storage"\./) { storage_copy = 1; next }
    print
    next
  }
  /^\\/ { refuse(10) }
  /^INSERT INTO "storage"\./ { refuse(12) }
  toupper($0) ~ /^[[:space:]]*(COMMIT|ROLLBACK|ABORT|SAVEPOINT|RELEASE|START[[:space:]]+TRANSACTION|PREPARE[[:space:]]+TRANSACTION|END[[:space:]]+(WORK|TRANSACTION))([[:space:];]|$)/ { refuse(11) }
  toupper($0) ~ /^[[:space:]]*BEGIN[[:space:]]*((WORK|TRANSACTION)[[:space:]]*)?;/ { refuse(11) }
  { print }
  END { if (!failure && in_copy) exit 13 }
'

readonly RESTORE_VERSIONS_RENDER='
  $0 !~ /^[0-9]+$/ || length($0) < 2 || length($0) > 14 || ($0 in seen) || NR > 512 {
    failure = 1
    exit 1
  }
  { seen[$0] = 1; versions[NR] = $0 }
  END {
    if (failure || NR == 0) exit 1
    print "INSERT INTO \"auth\".\"schema_migrations\" (\"version\") VALUES"
    for (i = 1; i <= NR; i++) printf "  (\047%s\047)%s\n", versions[i], (i < NR ? "," : ";")
  }
'

restore_fail() {
  local status="${1:?status is required}"
  local message="${2:?message is required}"
  printf 'budget ops: %s\n' "${message}" >&2
  exit "${status}"
}

restore_usage() {
  restore_fail "${EXIT_USAGE}" 'usage: supabase-scratch-restore.sh {render BUNDLE|restore BUNDLE|fingerprint OUTPUT|compare EXPECTED ACTUAL|verify PRODUCTION_FINGERPRINT}'
}

restore_is_private_directory() {
  /usr/bin/perl -MFcntl=:mode -e '
    alarm 5;
    my @details = lstat($ARGV[0]);
    exit 1 unless @details && S_ISDIR($details[2]);
    exit 1 unless $details[4] == $< && (($details[2] & 0077) == 0);
  ' "$1"
}

restore_is_private_file() {
  /usr/bin/perl -MFcntl=:mode -e '
    alarm 5;
    my ($path, $limit) = @ARGV;
    my @details = lstat($path);
    exit 1 unless @details && S_ISREG($details[2]);
    exit 1 unless $details[4] == $< && (($details[2] & 0077) == 0);
    exit 1 unless $details[7] > 0 && $details[7] <= $limit;
  ' "$1" "$2"
}

restore_emit_asset() {
  cat "${RESTORE_SQL_DIR}/$1" || restore_fail "${EXIT_INPUT}" "restore asset is unreadable: $1"
}

restore_filter_dump() {
  local file="$1"
  local name="$2"
  local status=0
  LC_ALL=C /usr/bin/awk "${RESTORE_DUMP_FILTER}" "${file}" || status=$?
  case "${status}" in
    0) ;;
    10) restore_fail "${EXIT_INPUT}" "restore bundle contains a psql meta-command: ${name}" ;;
    11) restore_fail "${EXIT_INPUT}" "restore bundle contains transaction control: ${name}" ;;
    12) restore_fail "${EXIT_INPUT}" "restore bundle contains storage rows; scratch runs no storage service: ${name}" ;;
    13) restore_fail "${EXIT_INPUT}" "restore bundle has an unterminated COPY block: ${name}" ;;
    *) restore_fail "${EXIT_INPUT}" "restore bundle could not be filtered: ${name}" ;;
  esac
}

restore_references_role() {
  LC_ALL=C /usr/bin/awk -v needle="\"$2\"" '
    !/^[[:space:]]*--/ && index($0, needle) { found = 1; exit }
    END { exit !found }
  ' "$1"
}

# Validates the whole bundle before any target is contacted and prints the
# rendered auth.schema_migrations insert.
restore_prepare_bundle() {
  local bundle="$1"
  local file
  if [[ "${bundle}" != /* || "${bundle}" == *$'\n'* ]] || ! restore_is_private_directory "${bundle}"; then
    restore_fail "${EXIT_INPUT}" 'restore bundle directory is missing or unsafe'
  fi
  for file in "${RESTORE_DUMP_FILES[@]}"; do
    restore_is_private_file "${bundle}/${file}" "${RESTORE_MAX_DUMP_BYTES}" || \
      restore_fail "${EXIT_INPUT}" "restore bundle file is missing or unsafe: ${file}"
  done
  restore_is_private_file "${bundle}/${RESTORE_VERSIONS_FILE}" "${RESTORE_MAX_SMALL_BYTES}" || \
    restore_fail "${EXIT_INPUT}" "restore bundle file is missing or unsafe: ${RESTORE_VERSIONS_FILE}"
  for file in "${RESTORE_DUMP_FILES[@]}"; do
    restore_filter_dump "${bundle}/${file}" "${file}" > /dev/null
  done
  LC_ALL=C /usr/bin/awk "${RESTORE_VERSIONS_RENDER}" "${bundle}/${RESTORE_VERSIONS_FILE}" || \
    restore_fail "${EXIT_INPUT}" 'auth schema migration versions are invalid'
}

restore_begin_segment() {
  printf -- '-- budget-restore segment begin: %s\n' "$1"
}

restore_end_segment() {
  printf -- '\n-- budget-restore segment end: %s\n' "$1"
}

# Dumps may SET ROLE, SESSION AUTHORIZATION, or search_path; every later
# segment starts from supabase_admin defaults inside the same transaction.
restore_session_boundary() {
  printf '%s\n' \
    'RESET ROLE;' \
    'SET SESSION AUTHORIZATION DEFAULT;' \
    'RESET ALL;' \
    'SELECT pg_temp.budget_restore_assert_single_transaction();'
}

restore_render_stream() {
  local bundle="$1"
  local versions_sql="$2"
  local file role

  restore_begin_segment 'prepare-target'
  restore_emit_asset 'prepare-target.sql'
  restore_end_segment 'prepare-target'

  for role in "${RESTORE_PLATFORM_ROLES[@]}"; do
    if restore_references_role "${bundle}/roles.sql" "${role}"; then
      restore_begin_segment "platform-role:${role}"
      restore_emit_asset "platform-role-${role}.sql"
      restore_end_segment "platform-role:${role}"
    fi
  done

  restore_begin_segment 'neutralize-default-privileges'
  restore_emit_asset 'neutralize-default-privileges.sql'
  restore_end_segment 'neutralize-default-privileges'

  for file in "${RESTORE_DUMP_FILES[@]}"; do
    restore_begin_segment "${file}"
    restore_session_boundary
    case "${file}" in
      data.sql|migration-history.sql) printf '%s\n' 'SET session_replication_role = replica;' ;;
    esac
    restore_filter_dump "${bundle}/${file}" "${file}"
    restore_end_segment "${file}"
  done

  restore_begin_segment "${RESTORE_VERSIONS_FILE}"
  restore_session_boundary
  printf '%s\n' 'SET session_replication_role = replica;' "${versions_sql}"
  restore_end_segment "${RESTORE_VERSIONS_FILE}"

  restore_begin_segment 'reinstate-default-privileges'
  restore_session_boundary
  restore_emit_asset 'reinstate-default-privileges.sql'
  restore_end_segment 'reinstate-default-privileges'

  restore_begin_segment 'complete-restore'
  restore_session_boundary
  printf '%s\n' 'UPDATE pg_temp.budget_restore_state SET complete = true;'
  restore_end_segment 'complete-restore'
}

restore_bounded() {
  local deadline="$1"
  shift
  local remaining
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    restore_fail "${EXIT_DATABASE}" 'whole-operation deadline exceeded'
  fi
  /usr/bin/perl -e 'alarm shift @ARGV; exec @ARGV or die "exec failed\n"' "${remaining}" "$@"
}

restore_validate_docker_endpoint() {
  local deadline="$1"
  local endpoint
  if [[ -n "${DOCKER_HOST:-}" ]]; then
    endpoint="${DOCKER_HOST}"
  elif ! endpoint="$(restore_bounded "${deadline}" docker context inspect \
    --format '{{.Endpoints.docker.Host}}' 2>/dev/null)"; then
    restore_fail "${EXIT_TARGET}" 'docker endpoint could not be determined'
  fi
  [[ "${endpoint}" =~ ^(unix:///|ssh://)[^[:space:]]+$ ]] || \
    restore_fail "${EXIT_TARGET}" 'docker endpoint must be a local unix socket or ssh'
}

restore_validate_image() {
  local deadline="$1"
  local image_reference="$2"
  local image_id="$3"
  local digests repository
  local pinned=0
  case "${image_reference}" in
    "public.ecr.aws/supabase/postgres:${RESTORE_IMAGE_TAG}" | \
      "supabase/postgres:${RESTORE_IMAGE_TAG}" | \
      "docker.io/supabase/postgres:${RESTORE_IMAGE_TAG}") ;;
    *) restore_fail "${EXIT_TARGET}" "scratch target image must be supabase/postgres:${RESTORE_IMAGE_TAG}" ;;
  esac
  if ! digests="$(restore_bounded "${deadline}" docker image inspect \
    --format '{{range .RepoDigests}}{{.}} {{end}}' "${image_id}" 2>/dev/null)"; then
    restore_fail "${EXIT_TARGET}" 'scratch target image could not be inspected'
  fi
  for repository in public.ecr.aws/supabase/postgres supabase/postgres docker.io/supabase/postgres; do
    if [[ " ${digests} " == *" ${repository}@${RESTORE_IMAGE_DIGEST} "* ]]; then
      pinned=1
    fi
  done
  (( pinned == 1 )) || \
    restore_fail "${EXIT_TARGET}" "scratch target image digest is not the pinned supabase/postgres:${RESTORE_IMAGE_TAG}"
}

# Prints the full ID of the one running, labelled, pinned, loopback-only
# container named by BUDGET_SCRATCH_CONTAINER.
restore_resolve_target() {
  local deadline="$1"
  local requested="${BUDGET_SCRATCH_CONTAINER:-}"
  local record id running image_reference image_id label network bindings
  restore_validate_docker_endpoint "${deadline}"
  [[ "${requested}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || \
    restore_fail "${EXIT_TARGET}" 'BUDGET_SCRATCH_CONTAINER must name one container'
  if ! record="$(restore_bounded "${deadline}" docker inspect --type container --format \
    "{{.Id}}|{{.State.Running}}|{{.Config.Image}}|{{.Image}}|{{index .Config.Labels \"${RESTORE_LABEL_KEY}\"}}|{{.HostConfig.NetworkMode}}|{{range \$port, \$bound := .HostConfig.PortBindings}}{{range \$bound}}[{{.HostIp}}]{{end}}{{end}}{{range \$port, \$bound := .NetworkSettings.Ports}}{{range \$bound}}[{{.HostIp}}]{{end}}{{end}}" \
    "${requested}" 2>/dev/null)"; then
    restore_fail "${EXIT_TARGET}" 'scratch target container was not found'
  fi
  IFS='|' read -r id running image_reference image_id label network bindings <<< "${record}"
  if [[ ! "${id}" =~ ^[0-9a-f]{64}$ || "${running}" != 'true' || "${label}" != "${RESTORE_LABEL_VALUE}" ]]; then
    restore_fail "${EXIT_TARGET}" "scratch target must be a running container labelled ${RESTORE_LABEL_KEY}=${RESTORE_LABEL_VALUE}"
  fi
  restore_validate_image "${deadline}" "${image_reference}" "${image_id}"
  [[ "${network}" != 'host' ]] || \
    restore_fail "${EXIT_TARGET}" 'scratch target publishes a port beyond loopback'
  while [[ -n "${bindings}" ]]; do
    case "${bindings}" in
      '[127.0.0.1]'*) bindings="${bindings#\[127.0.0.1\]}" ;;
      '[::1]'*) bindings="${bindings#\[::1\]}" ;;
      *) restore_fail "${EXIT_TARGET}" 'scratch target publishes a port beyond loopback' ;;
    esac
  done
  printf '%s\n' "${id}"
}

restore_require_fingerprint_file() {
  if [[ "$1" != /* ]] || ! restore_is_private_file "$1" "${RESTORE_MAX_SMALL_BYTES}"; then
    restore_fail "${EXIT_INPUT}" 'fingerprint file is missing or unsafe'
  fi
  [[ "$(/usr/bin/head -n 1 "$1")" == "${RESTORE_FINGERPRINT_HEADER}" ]] || \
    restore_fail "${EXIT_INPUT}" "fingerprint file lacks the ${RESTORE_FINGERPRINT_HEADER} header"
}

restore_capture_fingerprint() {
  local deadline="$1"
  local container="$2"
  local output="$3"
  if ! (set -o noclobber; restore_bounded "${deadline}" docker exec -i "${container}" \
    psql -X -h 127.0.0.1 -U postgres -d postgres -f - \
    < "${RESTORE_SQL_DIR}/fingerprint.sql" > "${output}"); then
    restore_fail "${EXIT_DATABASE}" 'scratch fingerprint query failed'
  fi
}

restore_report_lines() {
  LC_ALL=C /usr/bin/awk -v prefix="$1" -v limit="${RESTORE_MAX_REPORT_LINES}" '
    NF && shown < limit { print prefix $0; shown++ }
  ' >&2
}

restore_compare_fingerprints() {
  local expected="$1"
  local actual="$2"
  local missing unexpected
  restore_require_fingerprint_file "${expected}"
  restore_require_fingerprint_file "${actual}"
  missing="$(LC_ALL=C comm -23 <(LC_ALL=C sort "${expected}") <(LC_ALL=C sort "${actual}"))"
  unexpected="$(LC_ALL=C comm -13 <(LC_ALL=C sort "${expected}") <(LC_ALL=C sort "${actual}"))"
  if [[ -z "${missing}" && -z "${unexpected}" ]]; then
    printf 'fingerprint matches production: %d lines\n' "$(LC_ALL=C /usr/bin/wc -l < "${expected}")"
    return 0
  fi
  printf '%s\n' "${missing}" | restore_report_lines 'missing in scratch: '
  printf '%s\n' "${unexpected}" | restore_report_lines 'unexpected in scratch: '
  printf 'budget ops: %s\n' 'fingerprint does not match production' >&2
  return 1
}

restore_check_foreign_keys() {
  local deadline="$1"
  local container="$2"
  local report
  if ! report="$(restore_bounded "${deadline}" docker exec -i "${container}" \
    psql -X -U supabase_admin -d postgres -f - \
    < "${RESTORE_SQL_DIR}/foreign-key-orphans.sql")"; then
    restore_fail "${EXIT_DATABASE}" 'foreign-key orphan query failed'
  fi
  printf '%s\n' "${report}" | LC_ALL=C /usr/bin/awk -F'|' -v limit="${RESTORE_MAX_REPORT_LINES}" '
    NF == 0 { next }
    $1 != "fk" || NF != 4 || $4 !~ /^[0-9]+$/ { malformed = 1; next }
    {
      constraints++
      if ($4 + 0 > 0 && offending < limit) print "orphan rows: " $0 > "/dev/stderr"
      if ($4 + 0 > 0) offending++
    }
    END {
      if (malformed) { print "budget ops: foreign-key orphan report is malformed" > "/dev/stderr"; exit 2 }
      if (offending) { print "budget ops: foreign-key orphan rows found" > "/dev/stderr"; exit 1 }
      printf "foreign keys checked: %d constraints, 0 orphan rows\n", constraints
    }
  '
}

restore_check_privilege_probes() {
  local deadline="$1"
  local container="$2"
  local manifest="${RESTORE_SQL_DIR}/privilege-probes.txt"
  local expected report
  if ! expected="$(LC_ALL=C /usr/bin/awk '
    /^#/ || /^$/ { next }
    !/^(anon|authenticated) (select|insert|update|delete|execute) [a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*(\([a-z0-9_ ,]*\))?$/ {
      invalid = 1
      exit 1
    }
    { probes++ }
    END { if (invalid || probes < 1 || probes > 64) exit 1; print probes }
  ' "${manifest}")"; then
    restore_fail "${EXIT_INPUT}" 'privilege probe manifest is invalid'
  fi
  if ! report="$(restore_bounded "${deadline}" docker exec -i "${container}" \
    psql -X -U supabase_admin -d postgres -v "probe_manifest=$(cat "${manifest}")" -f - \
    < "${RESTORE_SQL_DIR}/privilege-probes.sql")"; then
    restore_fail "${EXIT_DATABASE}" 'privilege probe query failed'
  fi
  printf '%s\n' "${report}" | LC_ALL=C /usr/bin/awk -F'|' -v expected="${expected}" '
    NF == 0 { next }
    $1 != "probe" || NF != 5 { malformed = 1; next }
    {
      total++
      if ($5 == "denied") denied++
      else printf "budget ops: privilege probe was not denied: %s %s %s (%s)\n", $2, $3, $4, $5 > "/dev/stderr"
    }
    END {
      if (malformed || total != expected) { print "budget ops: privilege probe report is incomplete" > "/dev/stderr"; exit 2 }
      if (denied != total) exit 1
      printf "privilege probes denied: %d/%d\n", denied, total
    }
  '
}

restore_command_render() {
  local bundle="$1"
  local versions_sql
  versions_sql="$(restore_prepare_bundle "${bundle}")"
  restore_render_stream "${bundle}" "${versions_sql}"
}

restore_command_restore() {
  local bundle="$1"
  local versions_sql deadline container status
  versions_sql="$(restore_prepare_bundle "${bundle}")"
  deadline="$(budget_start_deadline "${RESTORE_OPERATION_SECONDS}")"
  container="$(restore_resolve_target "${deadline}")"
  # A cut or failed stream reaches psql as end of input; the completion
  # sentinel in prepare-target.sql then refuses the commit.
  set +e
  (set -e; restore_render_stream "${bundle}" "${versions_sql}") \
    | restore_bounded "${deadline}" docker exec -i "${container}" \
      psql -X -q -o /dev/null -v ON_ERROR_STOP=1 --single-transaction \
        -U supabase_admin -d postgres -f -
  status=$?
  set -e
  (( status == 0 )) || \
    restore_fail "${EXIT_DATABASE}" 'scratch restore transaction failed and was rolled back'
  printf '%s\n' 'supabase scratch restore committed'
}

restore_command_fingerprint() {
  local output="$1"
  local deadline container
  [[ "${output}" == /* && ! -e "${output}" ]] || \
    restore_fail "${EXIT_USAGE}" 'fingerprint output must be a new absolute path'
  deadline="$(budget_start_deadline "${RESTORE_OPERATION_SECONDS}")"
  container="$(restore_resolve_target "${deadline}")"
  restore_capture_fingerprint "${deadline}" "${container}" "${output}"
  restore_require_fingerprint_file "${output}"
  printf 'scratch fingerprint written: %d lines\n' "$(LC_ALL=C /usr/bin/wc -l < "${output}")"
}

restore_command_compare() {
  restore_compare_fingerprints "$1" "$2" || \
    restore_fail "${EXIT_VERIFICATION}" 'supabase scratch restore verification failed'
}

restore_command_verify() {
  local production="$1"
  local deadline container work
  local failures=0
  restore_require_fingerprint_file "${production}"
  deadline="$(budget_start_deadline "${RESTORE_OPERATION_SECONDS}")"
  container="$(restore_resolve_target "${deadline}")"
  work="$(mktemp -d "${TMPDIR:-/tmp}/budget-supabase-verify.XXXXXX")"
  # shellcheck disable=SC2064 # expand the exact directory now
  trap "rm -f -- '${work}/scratch.fingerprint'; rmdir -- '${work}'" EXIT
  restore_capture_fingerprint "${deadline}" "${container}" "${work}/scratch.fingerprint"
  restore_compare_fingerprints "${production}" "${work}/scratch.fingerprint" || failures=1
  restore_check_foreign_keys "${deadline}" "${container}" || failures=1
  restore_check_privilege_probes "${deadline}" "${container}" || failures=1
  (( failures == 0 )) || \
    restore_fail "${EXIT_VERIFICATION}" 'supabase scratch restore verification failed'
  printf '%s\n' 'supabase scratch restore verified'
}

case "${1:-}" in
  render) (( $# == 2 )) || restore_usage; restore_command_render "$2" ;;
  restore) (( $# == 2 )) || restore_usage; restore_command_restore "$2" ;;
  fingerprint) (( $# == 2 )) || restore_usage; restore_command_fingerprint "$2" ;;
  compare) (( $# == 3 )) || restore_usage; restore_command_compare "$2" "$3" ;;
  verify) (( $# == 2 )) || restore_usage; restore_command_verify "$2" ;;
  *) restore_usage ;;
esac
