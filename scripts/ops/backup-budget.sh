#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly BACKUP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./budget-common.sh
source "${BACKUP_SCRIPT_DIR}/budget-common.sh"

readonly BACKUP_TIMEOUT_SECONDS=1800
readonly BACKUP_HELPER_TIMEOUT_SECONDS=300
readonly BACKUP_HASH_TIMEOUT_SECONDS=60
readonly BACKUP_VERIFY_TIMEOUT_SECONDS=15
readonly MAX_RETENTION_ROWS=1000
readonly KEEP_DAILY=14
readonly KEEP_WEEKLY=8
readonly KEEP_MONTHLY=12

backup_validate_scalar() {
  local value="${1:-}"
  local label="${2:?label is required}"
  if [[ -z "${value}" || ${#value} -gt 256 || "${value}" == *$'\n'* || \
    "${value}" == *$'\r'* ]]; then
    budget_error "invalid ${label}" 70
  fi
}

backup_validate_configuration() {
  budget_validate_environment >/dev/null
  if [[ "${BUDGET_VALIDATED_ENV}" != 'live' ]]; then
    budget_error 'encrypted release backups require the exact live target' 70
    return
  fi

  if [[ -z "${BUDGET_AGE_RECIPIENT:-}" ]]; then
    budget_error 'encryption recipient is not configured' 70
    return
  fi
  if [[ -z "${BUDGET_OFFSITE_DESTINATION:-}" ]]; then
    budget_error 'off-site destination is not configured' 70
    return
  fi

  backup_validate_scalar "${BUDGET_AGE_RECIPIENT}" 'encryption recipient'
  backup_validate_scalar "${BUDGET_OFFSITE_DESTINATION}" 'off-site destination'
  if [[ "${BUDGET_AGE_RECIPIENT}" != age1* ]]; then
    budget_error 'backup target configuration is outside the exact allowlist' 70
    return
  fi
  budget_validate_offsite_destination "${BUDGET_OFFSITE_DESTINATION}" \
    "${BUDGET_OFFSITE_ALLOWED_PREFIX:-}" 70

  local required_value
  for required_value in BUDGET_RUN_ID BUDGET_PGPASS_FILE BUDGET_DATABASE_HOST \
    BUDGET_DATABASE_PORT BUDGET_DATABASE_NAME BUDGET_DATABASE_USER \
    BUDGET_EXPECTED_DATABASE_OID BUDGET_DB_VERIFY_BIN BUDGET_VERIFY_PSQL_BIN \
    BUDGET_POSTGRES_MAJOR BUDGET_PG_DUMP_MAJOR BUDGET_PG_DUMP_VERSION BUDGET_RELEASE_ID \
    BUDGET_MIGRATION_MANIFEST BUDGET_REQUIRED_BYTES BUDGET_AVAILABLE_BYTES \
    BUDGET_TIMEOUT_BIN BUDGET_PG_DUMP_BIN BUDGET_PG_DUMPALL_BIN \
    BUDGET_AGE_BIN BUDGET_CATALOG_BIN BUDGET_OFFSITE_BIN BUDGET_CLOCK_BIN; do
    if [[ -z "${!required_value:-}" ]]; then
      budget_error "required backup setting is missing: ${required_value}" 70
      return
    fi
  done

  local database_identifier
  for database_identifier in "${BUDGET_DATABASE_HOST}" "${BUDGET_DATABASE_NAME}" \
    "${BUDGET_DATABASE_USER}" "${BUDGET_PGPASS_FILE}"; do
    if budget_is_protected_identifier "${database_identifier}"; then
      budget_error 'protected Sandooq/POS database identifier refused' 70
      return
    fi
  done

  if [[ ! "${BUDGET_RUN_ID}" =~ ^[0-9TZ:-]{16,32}-[A-Za-z0-9._-]{1,64}$ || \
    ! "${BUDGET_DATABASE_PORT}" =~ ^[0-9]{1,5}$ || \
    ! "${BUDGET_REQUIRED_BYTES}" =~ ^[0-9]{1,20}$ || \
    ! "${BUDGET_AVAILABLE_BYTES}" =~ ^[0-9]{1,20}$ || \
    ! "${BUDGET_EXPECTED_DATABASE_OID}" =~ ^[0-9]{1,20}$ || \
    ! "${BUDGET_RELEASE_ID}" =~ ^[A-Za-z0-9._-]{1,128}$ || \
    ! "${BUDGET_PG_DUMP_VERSION}" =~ ^17\.[0-9]{1,3}$ ]]; then
    budget_error 'backup configuration contains an invalid bounded value' 70
    return
  fi
  if [[ "${BUDGET_POSTGRES_MAJOR}" != '17' || \
    "${BUDGET_PG_DUMP_MAJOR}" != "${BUDGET_POSTGRES_MAJOR}" ]]; then
    budget_error 'PostgreSQL client major must exactly match approved major 17' 70
    return
  fi
  if (( BUDGET_AVAILABLE_BYTES < BUDGET_REQUIRED_BYTES )); then
    budget_error 'insufficient backup space' 71
    return
  fi
  budget_require_private_file "${BUDGET_PGPASS_FILE}" 70
  if [[ ! -f "${BUDGET_MIGRATION_MANIFEST}" ]]; then
    budget_error 'backup migration manifest is missing' 70
    return
  fi

  local executable
  for executable in "${BUDGET_TIMEOUT_BIN}" "${BUDGET_PG_DUMP_BIN}" \
    "${BUDGET_PG_DUMPALL_BIN}" "${BUDGET_AGE_BIN}" \
    "${BUDGET_CATALOG_BIN}" "${BUDGET_OFFSITE_BIN}" "${BUDGET_CLOCK_BIN}" \
    "${BUDGET_DB_VERIFY_BIN}" "${BUDGET_VERIFY_PSQL_BIN}"; do
    if [[ "${executable}" != /* || ! -x "${executable}" ]]; then
      budget_error 'backup executable boundary is not an absolute executable' 70
      return
    fi
  done
  if [[ "${BUDGET_DB_VERIFY_BIN}" != "${BACKUP_SCRIPT_DIR}/verify-budget-db.sh" ]]; then
    budget_error 'database verifier must be the tracked pinned verifier' 70
    return
  fi

  readonly BACKUP_RUN_ID="${BUDGET_RUN_ID}"
  readonly BACKUP_TIMEOUT_BIN="${BUDGET_TIMEOUT_BIN}"
  readonly BACKUP_ROOT="${BUDGET_VALIDATED_ROOT}"
  readonly BACKUP_DB_HOST="${BUDGET_DATABASE_HOST}"
  readonly BACKUP_DB_PORT="${BUDGET_DATABASE_PORT}"
  readonly BACKUP_DB_NAME="${BUDGET_DATABASE_NAME}"
  readonly BACKUP_DB_USER="${BUDGET_DATABASE_USER}"
  readonly BACKUP_DB_OID="${BUDGET_EXPECTED_DATABASE_OID}"
}

backup_measure_database() {
  BUDGET_VERIFY_PSQL_BIN="${BUDGET_VERIFY_PSQL_BIN}" \
    "${BACKUP_TIMEOUT_BIN}" "${BACKUP_VERIFY_TIMEOUT_SECONDS}" \
    "${BUDGET_DB_VERIFY_BIN}" "${BACKUP_DB_HOST}" "${BACKUP_DB_PORT}" \
    "${BACKUP_DB_NAME}" "${BACKUP_DB_USER}"
}

backup_hash() {
  local candidate="${1:?hash candidate is required}"
  local output
  output="$("${BACKUP_TIMEOUT_BIN}" "${BACKUP_HASH_TIMEOUT_SECONDS}" shasum -a 256 "${candidate}")"
  printf '%s\n' "${output%% *}"
}

backup_size() {
  local candidate="${1:?size candidate is required}"
  local output
  output="$("${BACKUP_TIMEOUT_BIN}" "${BACKUP_HASH_TIMEOUT_SECONDS}" wc -c < "${candidate}")"
  output="${output//[[:space:]]/}"
  [[ "${output}" =~ ^[0-9]{1,20}$ ]] || return 1
  printf '%s\n' "${output}"
}

backup_cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP

  if [[ "${backup_temp_created:-0}" == '1' ]]; then
    rm -f -- "${backup_archive_plain}" "${backup_roles_plain}" "${backup_catalog_plain}"
    rmdir -- "${backup_plain_dir}" 2>/dev/null || true
  fi
  if [[ "${backup_published:-0}" != '1' && "${backup_recovery_created:-0}" == '1' ]]; then
    rm -f -- "${backup_archive_cipher}" "${backup_roles_cipher}" \
      "${backup_catalog_cipher}" "${backup_manifest}" "${backup_success}"
    rmdir -- "${backup_recovery_dir}" 2>/dev/null || true
  fi
  if [[ "${backup_lock_acquired:-0}" == '1' ]]; then
    rmdir -- "${backup_lock_dir}" 2>/dev/null || true
  fi
  exit "${status}"
}

backup_execute() {
  backup_validate_configuration

  local backup_lock_acquired=0 backup_temp_created=0 backup_recovery_created=0
  local backup_published=0
  local backup_lock_dir="${BACKUP_ROOT}/locks/backup-live.lock"
  local backup_plain_dir="${BACKUP_ROOT}/tmp/${BACKUP_RUN_ID}.plaintext"
  local backup_recovery_dir="${BACKUP_ROOT}/backups/live/${BACKUP_RUN_ID}"
  local backup_archive_plain="${backup_plain_dir}/archive.dump"
  local backup_roles_plain="${backup_plain_dir}/roles.sql"
  local backup_catalog_plain="${backup_plain_dir}/catalog.txt"
  local backup_archive_cipher="${backup_recovery_dir}/archive.dump.age"
  local backup_roles_cipher="${backup_recovery_dir}/roles.sql.age"
  local backup_catalog_cipher="${backup_recovery_dir}/catalog.txt.age"
  local backup_manifest="${backup_recovery_dir}/manifest.txt"
  local backup_success="${backup_recovery_dir}/SUCCESS"
  local backup_started_at backup_finished_at backup_started_seconds="${SECONDS}"
  local initial_database_receipt current_database_receipt
  trap backup_cleanup EXIT INT TERM HUP

  mkdir -p -- "${BACKUP_ROOT}/locks"
  if ! mkdir -- "${backup_lock_dir}" 2>/dev/null; then
    budget_error 'backup is already running' 72
    return
  fi
  backup_lock_acquired=1
  export PGPASSFILE="${BUDGET_PGPASS_FILE}"
  initial_database_receipt="$(backup_measure_database)"
  budget_assert_database_receipt "${initial_database_receipt}" \
    "${BUDGET_VALIDATED_SYSTEM_ID}" "${BUDGET_POSTGRES_MAJOR}" \
    "${BACKUP_DB_NAME}" "${BACKUP_DB_OID}" 0 68 >/dev/null
  budget_revalidate_environment
  backup_started_at="$("${BACKUP_TIMEOUT_BIN}" "${BACKUP_HASH_TIMEOUT_SECONDS}" \
    "${BUDGET_CLOCK_BIN}")"

  mkdir -p -- "${BACKUP_ROOT}/tmp" "${BACKUP_ROOT}/backups/live"
  if ! mkdir -- "${backup_plain_dir}"; then
    budget_error 'backup plaintext directory already exists' 72
    return
  fi
  backup_temp_created=1
  if ! mkdir -- "${backup_recovery_dir}"; then
    budget_error 'backup recovery point already exists' 72
    return
  fi
  backup_recovery_created=1

  export PGCONNECT_TIMEOUT=5
  export PGOPTIONS='-c lock_timeout=30s -c statement_timeout=29min'
  current_database_receipt="$(backup_measure_database)"
  if [[ "${current_database_receipt}" != "${initial_database_receipt}" ]]; then
    budget_error 'database identity changed before backup' 68
    return
  fi
  budget_assert_database_receipt "${current_database_receipt}" \
    "${BUDGET_VALIDATED_SYSTEM_ID}" "${BUDGET_POSTGRES_MAJOR}" \
    "${BACKUP_DB_NAME}" "${BACKUP_DB_OID}" 0 68 >/dev/null
  budget_revalidate_environment

  "${BACKUP_TIMEOUT_BIN}" "${BACKUP_TIMEOUT_SECONDS}" \
    "${BUDGET_PG_DUMP_BIN}" --format=custom --compress=9 \
    --file="${backup_archive_plain}" --host="${BACKUP_DB_HOST}" \
    --port="${BACKUP_DB_PORT}" --username="${BACKUP_DB_USER}" \
    --dbname="${BACKUP_DB_NAME}"
  "${BACKUP_TIMEOUT_BIN}" "${BACKUP_TIMEOUT_SECONDS}" \
    "${BUDGET_PG_DUMPALL_BIN}" --roles-only --no-role-passwords \
    --host="${BACKUP_DB_HOST}" --port="${BACKUP_DB_PORT}" \
    --username="${BACKUP_DB_USER}" > "${backup_roles_plain}"
  "${BACKUP_TIMEOUT_BIN}" "${BACKUP_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_CATALOG_BIN}" --database="${BACKUP_DB_NAME}" \
    --max-row-summaries=100 > "${backup_catalog_plain}"

  "${BACKUP_TIMEOUT_BIN}" "${BACKUP_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_AGE_BIN}" -r "${BUDGET_AGE_RECIPIENT}" \
    -o "${backup_archive_cipher}" "${backup_archive_plain}"
  "${BACKUP_TIMEOUT_BIN}" "${BACKUP_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_AGE_BIN}" -r "${BUDGET_AGE_RECIPIENT}" \
    -o "${backup_roles_cipher}" "${backup_roles_plain}"
  "${BACKUP_TIMEOUT_BIN}" "${BACKUP_HELPER_TIMEOUT_SECONDS}" \
    "${BUDGET_AGE_BIN}" -r "${BUDGET_AGE_RECIPIENT}" \
    -o "${backup_catalog_cipher}" "${backup_catalog_plain}"

  local migration_hash archive_hash roles_hash catalog_hash catalog_metadata_hash
  local archive_size roles_size catalog_size duration_seconds
  migration_hash="$(backup_hash "${BUDGET_MIGRATION_MANIFEST}")"
  archive_hash="$(backup_hash "${backup_archive_cipher}")"
  roles_hash="$(backup_hash "${backup_roles_cipher}")"
  catalog_hash="$(backup_hash "${backup_catalog_cipher}")"
  catalog_metadata_hash="$(backup_hash "${backup_catalog_plain}")"
  archive_size="$(backup_size "${backup_archive_cipher}")"
  roles_size="$(backup_size "${backup_roles_cipher}")"
  catalog_size="$(backup_size "${backup_catalog_cipher}")"
  backup_finished_at="$("${BACKUP_TIMEOUT_BIN}" "${BACKUP_HASH_TIMEOUT_SECONDS}" \
    "${BUDGET_CLOCK_BIN}")"
  duration_seconds=$((SECONDS - backup_started_seconds))
  {
    printf '%s\n' 'backup_manifest_version=1'
    printf 'run_id=%s\n' "${BACKUP_RUN_ID}"
    printf 'environment=%s\n' "${BUDGET_VALIDATED_ENV}"
    printf 'project=%s\n' "${BUDGET_VALIDATED_PROJECT}"
    printf 'system_id=%s\n' "${BUDGET_VALIDATED_SYSTEM_ID}"
    printf 'postgres_major=%s\n' "${BUDGET_POSTGRES_MAJOR}"
    printf 'pg_dump_major=%s\n' "${BUDGET_PG_DUMP_MAJOR}"
    printf 'pg_dump_version=%s\n' "${BUDGET_PG_DUMP_VERSION}"
    printf '%s\n' 'backup_tool_version=budget-backup-v1'
    printf 'started_at_utc=%s\n' "${backup_started_at}"
    printf 'finished_at_utc=%s\n' "${backup_finished_at}"
    printf 'duration_seconds=%s\n' "${duration_seconds}"
    printf 'release_id=%s\n' "${BUDGET_RELEASE_ID}"
    printf 'migration_manifest_sha256=%s\n' "${migration_hash}"
    printf 'catalog_metadata_sha256=%s\n' "${catalog_metadata_hash}"
    printf 'archive.dump.age_size=%s\n' "${archive_size}"
    printf 'roles.sql.age_size=%s\n' "${roles_size}"
    printf 'catalog.txt.age_size=%s\n' "${catalog_size}"
    printf '%s  %s\n' "${archive_hash}" 'archive.dump.age'
    printf '%s  %s\n' "${roles_hash}" 'roles.sql.age'
    printf '%s  %s\n' "${catalog_hash}" 'catalog.txt.age'
  } > "${backup_manifest}"

  local payload
  for payload in "${backup_archive_cipher}" "${backup_roles_cipher}" \
    "${backup_catalog_cipher}" "${backup_manifest}"; do
    "${BACKUP_TIMEOUT_BIN}" "${BACKUP_HELPER_TIMEOUT_SECONDS}" \
      "${BUDGET_OFFSITE_BIN}" put "${payload}" \
      "${BUDGET_OFFSITE_DESTINATION}" "${BACKUP_RUN_ID}/${payload##*/}"
    "${BACKUP_TIMEOUT_BIN}" "${BACKUP_HELPER_TIMEOUT_SECONDS}" \
      "${BUDGET_OFFSITE_BIN}" verify "${payload}" \
      "${BUDGET_OFFSITE_DESTINATION}" "${BACKUP_RUN_ID}/${payload##*/}"
  done

  : > "${backup_success}"
  backup_published=1
  printf '%s\n' "verified encrypted recovery point ${BACKUP_RUN_ID}"
}

backup_dry_run() {
  backup_validate_configuration
  printf '%s\n' 'DRY RUN ONLY: no lock, dump, encryption, upload, cleanup, or database/network command executed'
  printf '%s\n' 'external recovery evidence remains BLOCKED until configured off-site proof and scratch restore'
}

backup_retention_epoch() {
  local timestamp="${1:-}"
  local tier="${2:-}"
  /usr/bin/perl -MTime::Local=timegm -e '
    alarm 5;
    my ($timestamp, $tier) = @ARGV;
    exit 1 unless $timestamp =~ /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/;
    my ($year, $month, $day, $hour, $minute, $second) = ($1, $2, $3, $4, $5, $6);
    my $epoch = eval { timegm($second, $minute, $hour, $day, $month - 1, $year) };
    exit 1 if $@;
    my @utc = gmtime($epoch);
    my $round_trip = sprintf(
      "%04d-%02d-%02dT%02d:%02d:%02dZ",
      $utc[5] + 1900, $utc[4] + 1, $utc[3], $utc[2], $utc[1], $utc[0]
    );
    exit 1 unless $round_trip eq $timestamp;
    exit 1 if $tier eq "weekly" && $utc[6] != 0;
    exit 1 if $tier eq "monthly" && $utc[3] != 1;
    print "$epoch\n";
  ' "${timestamp}" "${tier}"
}

backup_retention_plan() {
  local index="${1:-}"
  if [[ -z "${index}" || ! -f "${index}" ]]; then
    budget_error 'retention index is required' 73
    return
  fi

  local -a ids=() timestamps=() epochs=() tiers=() pins=() verifications=()
  local id timestamp tier pin verification extra count=0 newest_epoch=''
  local last_daily='' last_weekly='' last_monthly='' epoch seen_id
  while IFS='|' read -r id timestamp tier pin verification extra; do
    [[ -z "${id}${timestamp}${tier}${pin}${verification}${extra}" ]] && continue
    count=$((count + 1))
    if (( count > MAX_RETENTION_ROWS )); then
      budget_error 'retention index exceeds 1000 rows' 73
      return
    fi
    if [[ ! "${id}" =~ ^budget-live-[A-Za-z0-9._-]+$ ]]; then
      budget_error 'retention index contains an unsafe prefix' 73
      return
    fi
    if budget_is_protected_identifier "${id}"; then
      budget_error 'retention index contains a protected identifier' 73
      return
    fi
    if (( count > 1 )); then
      for seen_id in "${ids[@]}"; do
        if [[ "${seen_id}" == "${id}" ]]; then
          budget_error 'retention index contains a duplicate recovery ID' 73
          return
        fi
      done
    fi
    if [[ ! "${timestamp}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ || \
      ! "${tier}" =~ ^(daily|weekly|monthly)$ || \
      ! "${pin}" =~ ^(normal|pinned)$ || \
      ! "${verification}" =~ ^(verified|unverified)$ || -n "${extra}" ]]; then
      budget_error 'retention index contains an invalid bounded row' 73
      return
    fi
    epoch="$(backup_retention_epoch "${timestamp}" "${tier}")" || {
      budget_error 'UTC retention date or tier eligibility is invalid' 73
      return
    }
    case "${tier}" in
      daily)
        [[ -n "${last_daily}" && "${epoch}" -gt "${last_daily}" ]] && {
          budget_error 'daily retention rows are not newest-first' 73; return; }
        last_daily="${epoch}"
        ;;
      weekly)
        [[ -n "${last_weekly}" && "${epoch}" -gt "${last_weekly}" ]] && {
          budget_error 'weekly retention rows are not newest-first' 73; return; }
        last_weekly="${epoch}"
        ;;
      monthly)
        [[ -n "${last_monthly}" && "${epoch}" -gt "${last_monthly}" ]] && {
          budget_error 'monthly retention rows are not newest-first' 73; return; }
        last_monthly="${epoch}"
        ;;
    esac
    [[ -z "${newest_epoch}" || "${epoch}" -gt "${newest_epoch}" ]] && newest_epoch="${epoch}"
    ids+=("${id}")
    timestamps+=("${timestamp}")
    epochs+=("${epoch}")
    tiers+=("${tier}")
    pins+=("${pin}")
    verifications+=("${verification}")
  done < "${index}"
  if (( count == 0 )); then
    budget_error 'retention index is empty' 73
    return
  fi

  local daily_count=0 weekly_count=0 monthly_count=0 position reason limit tier_count
  for ((position = 0; position < count; position += 1)); do
    if [[ "${epochs[position]}" == "${newest_epoch}" ]]; then
      reason='newest'
    elif [[ "${pins[position]}" == 'pinned' ]]; then
      reason='incident-pinned'
    elif [[ "${verifications[position]}" != 'verified' ]]; then
      reason='unverified'
    else
      case "${tiers[position]}" in
        daily) tier_count="${daily_count}"; limit="${KEEP_DAILY}" ;;
        weekly) tier_count="${weekly_count}"; limit="${KEEP_WEEKLY}" ;;
        monthly) tier_count="${monthly_count}"; limit="${KEEP_MONTHLY}" ;;
      esac
      if (( tier_count < limit )); then
        reason="${tiers[position]}-retained"
      else
        reason="${tiers[position]}-expired"
      fi
    fi

    if [[ "${pins[position]}" != 'pinned' && "${verifications[position]}" == 'verified' ]]; then
      case "${tiers[position]}" in
        daily) daily_count=$((daily_count + 1)) ;;
        weekly) weekly_count=$((weekly_count + 1)) ;;
        monthly) monthly_count=$((monthly_count + 1)) ;;
      esac
    fi
    if [[ "${reason}" == *-expired ]]; then
      printf 'delete|%s|%s\n' "${ids[position]}" "${reason}"
    else
      printf 'keep|%s|%s\n' "${ids[position]}" "${reason}"
    fi
  done
}

case "${1:-}" in
  backup) backup_execute ;;
  dry-run) backup_dry_run ;;
  retention-plan) backup_retention_plan "${2:-}" ;;
  *) budget_error 'usage: backup-budget.sh {backup|dry-run|retention-plan INDEX}' 64 ;;
esac
