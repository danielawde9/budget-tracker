#!/bin/bash
set -euo pipefail
umask 077
# The wrapped command keeps the caller's PATH (Node may come from a version
# manager); this script's own utilities use the fixed ops allowlist.
readonly BRIDGE_CALLER_PATH="${PATH:-}"
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly BRIDGE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./budget-common.sh
source "${BRIDGE_SCRIPT_DIR}/budget-common.sh"

# Runs one command with DOCKER_HOST pointing at a private local unix socket
# that reaches the Le Labo Ubuntu Docker daemon. Testcontainers 12.1.0 needs a
# unix socket, and Tailscale SSH on that host refuses socket forwarding but
# allows exec sessions, so every accepted connection runs
# `docker system dial-stdio` over one multiplexed SSH master. See the Tests
# subsection of docs/operations/backup-restore-runbook.md.

readonly BRIDGE_REMOTE_ADDRESS='100.76.160.91'
readonly BRIDGE_REMOTE_HOST="lelabo@${BRIDGE_REMOTE_ADDRESS}"
readonly BRIDGE_MAX_CONNECTIONS=32
readonly BRIDGE_DEFAULT_READY_SECONDS=30
readonly BRIDGE_MAX_READY_SECONDS=120
readonly BRIDGE_CONTROL_PERSIST_SECONDS=900
readonly BRIDGE_MASTER_EXIT_SECONDS=5
# macOS sockaddr_un.sun_path holds 104 bytes including the terminating NUL.
readonly BRIDGE_SOCKET_PATH_BYTES=104
# OpenSSH first binds a new master at ControlPath plus "." and 16 characters.
readonly BRIDGE_MUX_SUFFIX_BYTES=17
readonly BRIDGE_DIR_TEMPLATE='bdb.XXXXXXXX'
readonly BRIDGE_CONTROL_NAME='ssh'
readonly BRIDGE_SOCKET_NAME='docker.sock'
# Polls are 0.1 s apart: 5 s to listen, 10 s for the command or bridge to stop.
readonly BRIDGE_START_POLLS=50
readonly BRIDGE_STOP_POLLS=100
# Command-line options win over ssh_config, so a HostName, ProxyJump, or
# ProxyCommand entry for this host cannot route the bridge elsewhere.
readonly -a BRIDGE_SSH_OPTIONS=(
  -o BatchMode=yes
  -o "HostName=${BRIDGE_REMOTE_ADDRESS}"
  -o ProxyJump=none
  -o ProxyCommand=none
  -o ConnectTimeout=10
  -o ConnectionAttempts=2
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=2
)

readonly EXIT_USAGE=64
readonly EXIT_CONFIG=65
readonly EXIT_BRIDGE=66
readonly EXIT_CLEANUP=70

# Accept loop plus two pumps per connection. Client EOF closes ssh stdin and
# keeps relaying the response (half-close); ssh stdout EOF ends the connection.
# While the remote is silent, a POLLHUP on the client means it closed fully, so
# the session is ended instead of holding a slot until the remote speaks.
IFS= read -r -d '' BRIDGE_PROGRAM <<'PY' || true
import errno
import os
import select
import signal
import socket
import subprocess
import sys
import threading
import time

CHUNK_BYTES = 65536
HANGUP_POLL_MILLISECONDS = 1000
PARENT_POLL_SECONDS = 1
REAP_SECONDS = 5


def log(message):
    sys.stderr.write('budget ops: docker-ssh-bridge: %s\n' % message)
    sys.stderr.flush()


def write_all(fd, data):
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]


class Bridge:
    def __init__(self, limit, command):
        self.limit = limit
        self.command = command
        self.slots = threading.BoundedSemaphore(limit)
        self.lock = threading.Lock()
        self.children = set()
        self.closing = False

    def start_child(self):
        with self.lock:
            if self.closing:
                return None
            # A new session keeps a terminal Ctrl-C from ending SSH sessions
            # before stop_all marks the bridge as closing.
            process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                bufsize=0,
                start_new_session=True,
            )
            self.children.add(process)
            return process

    def reap(self, process, ended_by):
        try:
            status = process.wait(timeout=REAP_SECONDS)
        except subprocess.TimeoutExpired:
            log('ssh did not exit within %ds; killing it' % REAP_SECONDS)
            process.kill()
            status = process.wait(timeout=REAP_SECONDS)
        with self.lock:
            self.children.discard(process)
            stopping = self.closing
        # stop_all terminates open sessions, and OpenSSH mux clients then exit
        # 255; only an end the bridge did not cause is an SSH failure.
        if ended_by == 'remote' and status != 0 and not stopping:
            log('ssh exited with status %d' % status)

    def stop_all(self):
        with self.lock:
            self.closing = True
            children = list(self.children)
        for process in children:
            if process.poll() is None:
                process.terminate()
        deadline = time.monotonic() + REAP_SECONDS
        for process in children:
            try:
                process.wait(timeout=max(0.0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                log('ssh did not stop within %ds; killing it' % REAP_SECONDS)
                process.kill()


def pump_to_remote(client, process):
    try:
        while True:
            data = client.recv(CHUNK_BYTES)
            if not data:
                return
            write_all(process.stdin.fileno(), data)
    except (BrokenPipeError, ConnectionResetError):
        # ssh or the client went away; pump_to_client observes the end.
        return
    finally:
        process.stdin.close()


def client_hung_up(watcher):
    return any(flags & (select.POLLHUP | select.POLLERR) for _, flags in watcher.poll(0))


def pump_to_client(client, process):
    stdout = process.stdout.fileno()
    remote = select.poll()
    remote.register(stdout, select.POLLIN)
    watcher = select.poll()
    watcher.register(client.fileno(), select.POLLOUT)
    while True:
        if not remote.poll(HANGUP_POLL_MILLISECONDS):
            if client_hung_up(watcher):
                return 'client'
            continue
        data = os.read(stdout, CHUNK_BYTES)
        if not data:
            return 'remote'
        try:
            client.sendall(data)
        except (BrokenPipeError, ConnectionResetError):
            return 'client'


def shut_down(client):
    try:
        client.shutdown(socket.SHUT_RDWR)
    except OSError as error:
        # macOS reports ENOTCONN once the client has shut down its side; the
        # feeder has then seen EOF, and close() delivers EOF instead.
        if error.errno != errno.ENOTCONN:
            raise


def serve_connection(bridge, client):
    process = None
    released = False
    try:
        process = bridge.start_child()
        if process is None:
            return
        feeder = threading.Thread(target=pump_to_remote, args=(client, process), daemon=True)
        feeder.start()
        ended_by = pump_to_client(client, process)
        if ended_by == 'client':
            process.terminate()
        bridge.reap(process, ended_by)
        # Free the slot before the client can observe EOF.
        bridge.slots.release()
        released = True
        shut_down(client)
        feeder.join(REAP_SECONDS)
    except OSError as error:
        log('connection failed: %s' % error)
    finally:
        if process is not None and process.poll() is None:
            process.kill()
        if not released:
            bridge.slots.release()
        client.close()
        if process is not None:
            process.stdout.close()


def stop(signum, frame):
    raise SystemExit(0)


def main():
    socket_path, limit, command = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
    signal.signal(signal.SIGTERM, stop)
    parent = os.getppid()
    bridge = Bridge(limit, command)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        # Listen before the final name appears so a found socket accepts.
        listener.bind(socket_path + '.new')
        listener.listen(64)
        os.rename(socket_path + '.new', socket_path)
        # Wake up regularly so a helper killed before its cleanup cannot leave
        # the bridge serving; accepted sockets stay blocking.
        listener.settimeout(PARENT_POLL_SECONDS)
        while os.getppid() == parent:
            try:
                client, _ = listener.accept()
            except socket.timeout:
                continue
            if not bridge.slots.acquire(blocking=False):
                log('connection limit (%d) reached; refusing a connection' % limit)
                client.close()
                continue
            threading.Thread(target=serve_connection, args=(bridge, client), daemon=True).start()
        log('helper exited without stopping the bridge; stopping it now')
    finally:
        listener.close()
        bridge.stop_all()


main()
PY
readonly BRIDGE_PROGRAM

BRIDGE_DIR=''
BRIDGE_PID=''
COMMAND_PID=''

bridge_fail() {
  local status="${1:?status is required}"
  local message="${2:?message is required}"
  budget_error "docker-ssh-bridge: ${message}" "${status}" || exit "${status}"
}

bridge_validate_configuration() {
  local ready_seconds="$1" ssh_bin="$2" temporary_root="$3"
  local mux_bytes
  if [[ ! "${ready_seconds}" =~ ^[1-9][0-9]{0,2}$ ]] || (( ready_seconds > BRIDGE_MAX_READY_SECONDS )); then
    bridge_fail "${EXIT_CONFIG}" \
      "BUDGET_DOCKER_BRIDGE_READY_SECONDS must be a whole number from 1 to ${BRIDGE_MAX_READY_SECONDS}"
  fi
  [[ "${ssh_bin}" == /* && -f "${ssh_bin}" && -x "${ssh_bin}" ]] || \
    bridge_fail "${EXIT_CONFIG}" 'BUDGET_DOCKER_BRIDGE_SSH_BIN must be an absolute path to an executable file'
  # ssh splits -o values on whitespace and expands % tokens in ControlPath.
  [[ "${temporary_root}" =~ ^/[A-Za-z0-9._/-]*$ && -d "${temporary_root}" ]] || \
    bridge_fail "${EXIT_CONFIG}" 'TMPDIR must be an existing absolute directory named with [A-Za-z0-9._/-] only'
  mux_bytes=$(( ${#temporary_root} + 1 + ${#BRIDGE_DIR_TEMPLATE} + 1 + ${#BRIDGE_CONTROL_NAME} + BRIDGE_MUX_SUFFIX_BYTES ))
  if (( mux_bytes >= BRIDGE_SOCKET_PATH_BYTES )); then
    bridge_fail "${EXIT_CONFIG}" \
      "SSH control socket path would be ${mux_bytes} bytes; the limit is $(( BRIDGE_SOCKET_PATH_BYTES - 1 )). Set TMPDIR to a shorter directory"
  fi
}

# Testcontainers 12.1.0 tries tc.host from ~/.testcontainers.properties before
# DOCKER_HOST, so that setting would silently bypass the bridge.
bridge_refuse_testcontainers_host() {
  local properties="${HOME:-}/.testcontainers.properties" status=0
  [[ -n "${HOME:-}" && -e "${properties}" ]] || return 0
  grep -Eq '^[[:space:]]*tc\.host([[:space:]]|[=:])' "${properties}" || status=$?
  case "${status}" in
    0) bridge_fail "${EXIT_CONFIG}" "${properties} sets tc.host, which Testcontainers prefers over DOCKER_HOST; remove it to use the bridge" ;;
    1) return 0 ;;
    *) bridge_fail "${EXIT_CONFIG}" "cannot read ${properties}" ;;
  esac
}

bridge_stop_process() {
  local pid="$1" label="$2" poll
  [[ -n "${pid}" ]] || return 0
  # A failed signal means the process already exited.
  kill -TERM "${pid}" 2>/dev/null || return 0
  for ((poll = 0; poll < BRIDGE_STOP_POLLS; poll += 1)); do
    kill -0 "${pid}" 2>/dev/null || return 0
    sleep 0.1
  done
  budget_error "docker-ssh-bridge: ${label} did not stop within 10s; killing it" 1 || true
  kill -KILL "${pid}" 2>/dev/null || true
  return 1
}

bridge_exit_master() {
  local control="${BRIDGE_DIR}/${BRIDGE_CONTROL_NAME}" poll
  [[ -S "${control}" ]] || return 0
  if ! /usr/bin/perl -e '$SIG{ALRM} = sub { exit 124 }; alarm shift @ARGV; exec @ARGV; exit 127;' \
    "${BRIDGE_MASTER_EXIT_SECONDS}" "${BRIDGE_SSH_BIN}" \
    -o "ControlPath=${control}" -O exit "${BRIDGE_REMOTE_HOST}"; then
    budget_error 'docker-ssh-bridge: SSH master did not accept the exit request' 1 || return 1
  fi
  for ((poll = 0; poll < BRIDGE_START_POLLS; poll += 1)); do
    [[ -S "${control}" ]] || return 0
    sleep 0.1
  done
  budget_error 'docker-ssh-bridge: SSH master kept its control socket after exiting' 1 || return 1
}

bridge_cleanup() {
  local status=$? failed=0
  # Cleanup is bounded; a repeated interrupt must not abandon the bridge.
  trap '' INT TERM
  set +e
  bridge_stop_process "${COMMAND_PID}" 'command' || failed=1
  bridge_stop_process "${BRIDGE_PID}" 'bridge' || failed=1
  if [[ -n "${BRIDGE_DIR}" ]]; then
    bridge_exit_master || failed=1
    rm -f -- "${BRIDGE_DIR}/${BRIDGE_SOCKET_NAME}" "${BRIDGE_DIR}/${BRIDGE_SOCKET_NAME}.new"
    rmdir -- "${BRIDGE_DIR}" || failed=1
  fi
  if (( status == 0 && failed != 0 )); then
    status="${EXIT_CLEANUP}"
  fi
  exit "${status}"
}

bridge_interrupted() {
  trap '' INT TERM
  exit "$1"
}

bridge_wait_for_listener() {
  local socket="$1" poll
  for ((poll = 0; poll < BRIDGE_START_POLLS; poll += 1)); do
    [[ -S "${socket}" ]] && return 0
    kill -0 "${BRIDGE_PID}" 2>/dev/null || bridge_fail "${EXIT_BRIDGE}" 'bridge exited before listening'
    sleep 0.1
  done
  bridge_fail "${EXIT_BRIDGE}" 'bridge did not listen within 5s'
}

bridge_ping() {
  local socket="$1" ready_seconds="$2" reply
  # -q must come first; it keeps ~/.curlrc from changing the readiness request.
  if ! reply="$(/usr/bin/curl -q --silent --show-error --max-time "${ready_seconds}" \
    --unix-socket "${socket}" http://docker/_ping)" || [[ "${reply}" != 'OK' ]]; then
    bridge_fail "${EXIT_BRIDGE}" \
      "remote Docker did not answer /_ping through ${BRIDGE_REMOTE_HOST} within ${ready_seconds}s. If Tailscale SSH check mode is waiting for browser approval, re-authenticate Tailscale and retry; SSH diagnostics appear above."
  fi
}

if [[ "${1:-}" != 'run' || "${2:-}" != '--' || $# -lt 3 ]]; then
  bridge_fail "${EXIT_USAGE}" 'usage: docker-ssh-bridge.sh run -- COMMAND [ARGUMENT...]'
fi
shift 2

readonly BRIDGE_READY_SECONDS="${BUDGET_DOCKER_BRIDGE_READY_SECONDS:-${BRIDGE_DEFAULT_READY_SECONDS}}"
readonly BRIDGE_SSH_BIN="${BUDGET_DOCKER_BRIDGE_SSH_BIN:-/usr/bin/ssh}"
BRIDGE_TEMPORARY_ROOT="${TMPDIR:-/tmp}"
readonly BRIDGE_TEMPORARY_ROOT="${BRIDGE_TEMPORARY_ROOT%/}"
bridge_validate_configuration "${BRIDGE_READY_SECONDS}" "${BRIDGE_SSH_BIN}" "${BRIDGE_TEMPORARY_ROOT}"
bridge_refuse_testcontainers_host

trap bridge_cleanup EXIT
trap 'bridge_interrupted 130' INT
trap 'bridge_interrupted 143' TERM

if ! BRIDGE_DIR="$(mktemp -d "${BRIDGE_TEMPORARY_ROOT}/${BRIDGE_DIR_TEMPLATE}")"; then
  bridge_fail "${EXIT_BRIDGE}" 'cannot create the private bridge directory'
fi
readonly BRIDGE_SOCKET="${BRIDGE_DIR}/${BRIDGE_SOCKET_NAME}"

# -I keeps the working directory, PYTHONPATH, and user site out of sys.path.
/usr/bin/python3 -I -c "${BRIDGE_PROGRAM}" "${BRIDGE_SOCKET}" "${BRIDGE_MAX_CONNECTIONS}" \
  "${BRIDGE_SSH_BIN}" "${BRIDGE_SSH_OPTIONS[@]}" \
  -o ControlMaster=auto \
  -o "ControlPath=${BRIDGE_DIR}/${BRIDGE_CONTROL_NAME}" \
  -o "ControlPersist=${BRIDGE_CONTROL_PERSIST_SECONDS}" \
  "${BRIDGE_REMOTE_HOST}" docker system dial-stdio &
BRIDGE_PID=$!

bridge_wait_for_listener "${BRIDGE_SOCKET}"
bridge_ping "${BRIDGE_SOCKET}" "${BRIDGE_READY_SECONDS}"

DOCKER_HOST="unix://${BRIDGE_SOCKET}" TESTCONTAINERS_RYUK_DISABLED=true PATH="${BRIDGE_CALLER_PATH}" \
  "$@" <&0 &
COMMAND_PID=$!
if wait "${COMMAND_PID}"; then
  command_status=0
else
  command_status=$?
fi
COMMAND_PID=''
# A client can fall back to another Docker endpoint when the bridge is gone, so
# a command that outlived the bridge proves nothing about the Le Labo host.
if ! kill -0 "${BRIDGE_PID}" 2>/dev/null; then
  bridge_fail "${EXIT_BRIDGE}" \
    "bridge exited while the command ran (command status ${command_status}); its Docker calls may not have reached ${BRIDGE_REMOTE_HOST}"
fi
exit "${command_status}"
