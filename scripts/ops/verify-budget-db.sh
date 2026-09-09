#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly verify_host="${1:-}"
readonly verify_port="${2:-}"
readonly verify_database="${3:-}"
readonly verify_user="${4:-}"
readonly verify_psql="${BUDGET_VERIFY_PSQL_BIN:-}"

if [[ $# -ne 4 || -z "${verify_host}" || \
  ! "${verify_port}" =~ ^[0-9]{1,5}$ || \
  ! "${verify_database}" =~ ^[a-z][a-z0-9_]{0,62}$ || \
  ! "${verify_user}" =~ ^[a-z][a-z0-9_]{0,62}$ || \
  "${verify_psql}" != /* || ! -x "${verify_psql}" ]]; then
  printf '%s\n' 'budget db verifier: invalid bounded connection contract' >&2
  exit 80
fi

export PGCONNECT_TIMEOUT=5
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5s -c lock_timeout=2s'
export BUDGET_VERIFY_DATABASE_NAME="${verify_database}"

readonly verify_sql="BEGIN READ ONLY;
SELECT
  (pg_control_system()).system_identifier::text || '|' ||
  (current_setting('server_version_num')::integer / 10000)::text || '|' ||
  current_database() || '|' ||
  (SELECT oid::text FROM pg_database WHERE datname = current_database()) || '|' ||
  (SELECT count(*)::text
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND namespace.nspname NOT IN ('pg_catalog', 'information_schema'));
COMMIT;"

exec "${verify_psql}" --no-psqlrc --no-password --tuples-only --no-align \
  --quiet --set=ON_ERROR_STOP=on --host="${verify_host}" --port="${verify_port}" \
  --username="${verify_user}" --dbname="${verify_database}" --command="${verify_sql}"
