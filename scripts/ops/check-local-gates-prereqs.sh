#!/bin/bash
set -euo pipefail
umask 077

# Reports whether this workstation can run the two service-backed gates
# (`pnpm test:db` and a full `pnpm check:ops`). It runs nothing and mutates
# nothing; it only reads versions, files, sockets, and one TCP port. See
# docs/operations/local-gates.md.
#
# Unlike the other ops scripts this one deliberately keeps the caller's PATH:
# the whole point is to find the caller's node/pnpm/docker (often installed by
# a version manager), not a fixed system allowlist.

readonly PREREQ_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PREREQ_REPO_ROOT="$(cd "${PREREQ_SCRIPT_DIR}/../.." && pwd -P)"
readonly PREREQ_TARGET="${1:-all}"

report_ok() { printf '%s\n' "OK      $*"; }
report_missing() { printf '%s\n' "MISSING $*"; }
report_blocked() { printf '%s\n' "BLOCKED $*"; }
report_note() { printf '%s\n' "NOTE    $*"; }

# Bounded TCP connect (macOS has no default `timeout`).
tcp_reachable() {
  local host="$1"
  local port="$2"
  /usr/bin/perl -MIO::Socket::INET -e '
    my ($host, $port) = @ARGV;
    my $socket = IO::Socket::INET->new(
      PeerAddr => $host, PeerPort => $port, Proto => "tcp", Timeout => 5,
    );
    exit($socket ? 0 : 1);
  ' "${host}" "${port}"
}

# Prints "<host> <port>" parsed from BUDGET_TEST_DATABASE_URL without ever
# echoing the URL (it can carry a password).
db_host_port() {
  local url="${BUDGET_TEST_DATABASE_URL:-}"
  local authority host port
  [[ -n "${url}" ]] || return 1
  authority="${url#*://}"
  authority="${authority%%/*}"
  authority="${authority##*@}"
  host="${authority%%:*}"
  port="${authority##*:}"
  if [[ "${port}" == "${host}" || -z "${port}" ]]; then
    port=5432
  fi
  [[ -n "${host}" ]] || return 1
  printf '%s %s\n' "${host}" "${port}"
}

docker_socket() {
  local socket
  if [[ -n "${DOCKER_HOST:-}" ]]; then
    case "${DOCKER_HOST}" in
      unix://*) printf '%s\n' "${DOCKER_HOST#unix://}" ;;
      *) return 1 ;;
    esac
    return 0
  fi
  for socket in "${HOME:-}/.docker/run/docker.sock" /var/run/docker.sock; do
    if [[ -S "${socket}" ]]; then
      printf '%s\n' "${socket}"
      return 0
    fi
  done
  return 1
}

check_toolchain() {
  local version
  if command -v node >/dev/null 2>&1; then
    version="$(node --version 2>/dev/null || printf '%s' 'unknown')"
    report_ok "node ${version} (expected v22.22.0)"
  else
    report_missing 'node not found on PATH'
    return 1
  fi
  if command -v pnpm >/dev/null 2>&1; then
    version="$(pnpm --version 2>/dev/null || printf '%s' 'unknown')"
    report_ok "pnpm ${version} (expected 11.17.0)"
  else
    report_missing 'pnpm not found on PATH'
    return 1
  fi
  return 0
}

check_db_prereqs() {
  local status=0
  local hostport host port
  if [[ -f "${PREREQ_REPO_ROOT}/.env.test" ]]; then
    report_ok '.env.test present (value not read)'
  else
    report_missing '.env.test absent; copy .env.test.example and set BUDGET_TEST_DATABASE_URL'
    status=1
  fi
  if hostport="$(db_host_port)"; then
    host="${hostport%% *}"
    port="${hostport##* }"
    if tcp_reachable "${host}" "${port}"; then
      report_ok "Postgres ${host}:${port} reachable"
    else
      report_blocked "Postgres ${host}:${port} unreachable (Tailscale down or wrong host/port)"
      status=1
    fi
  else
    report_missing 'BUDGET_TEST_DATABASE_URL not set in this shell (source ./.env.test)'
    status=1
  fi
  return "${status}"
}

check_ops_prereqs() {
  local status=0
  local socket
  if command -v shellcheck >/dev/null 2>&1; then
    report_ok 'shellcheck present; check:ops will lint the ops scripts'
  else
    report_note 'shellcheck absent; check:ops will fall back to bash -n'
  fi
  if socket="$(docker_socket)"; then
    report_ok "Docker socket ${socket} present"
  else
    report_blocked 'no reachable Docker unix socket (start Docker Desktop or use scripts/ops/docker-ssh-bridge.sh)'
    status=1
  fi
  return "${status}"
}

case "${PREREQ_TARGET}" in
  db|ops|all) ;;
  *)
    printf '%s\n' "usage: check-local-gates-prereqs.sh {db|ops|all}" >&2
    exit 64
    ;;
esac

final_status=0
check_toolchain || final_status=1

if [[ "${PREREQ_TARGET}" == 'db' || "${PREREQ_TARGET}" == 'all' ]]; then
  printf '%s\n' '--- database gate (pnpm test:db) ---'
  check_db_prereqs || final_status=1
fi

if [[ "${PREREQ_TARGET}" == 'ops' || "${PREREQ_TARGET}" == 'all' ]]; then
  printf '%s\n' '--- ops gate (pnpm check:ops) ---'
  check_ops_prereqs || final_status=1
fi

if (( final_status == 0 )); then
  printf '%s\n' 'All selected gate prerequisites are satisfied.'
else
  printf '%s\n' 'One or more selected gate prerequisites are not satisfied.' >&2
fi
exit "${final_status}"
