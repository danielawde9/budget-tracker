import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const helper = join(process.cwd(), 'scripts/ops/docker-ssh-bridge.sh');
const remoteAddress = '100.76.160.91';
const remoteHost = `lelabo@${remoteAddress}`;
const connectionLimit = 32;

// Stands in for `ssh`: records argv, fakes the multiplexing master's control
// socket, and then behaves like `docker system dial-stdio`.
const fakeSsh = String.raw`#!/usr/bin/python3
import os, socket, sys, time

args = sys.argv[1:]
with open(os.environ['FAKE_SSH_LOG'], 'a') as log:
    log.write(' '.join(args) + '\n')
control = next((a[len('ControlPath='):] for a in args if a.startswith('ControlPath=')), '')
if '-O' in args:
    marker = os.environ.get('FAKE_SSH_EXIT_MARKER')
    if marker:
        open(marker, 'w').close()
        time.sleep(1)
    if os.environ.get('FAKE_SSH_EXIT_FAILS') == '1':
        sys.stderr.write('Control socket connect(%s): Connection refused\n' % control)
        sys.exit(255)
    os.unlink(control)
    sys.exit(0)
with open(os.environ['FAKE_SSH_PIDS'], 'a') as pids:
    pids.write('%d\n' % os.getpid())
mode = os.environ.get('FAKE_SSH_MODE', 'relay')
if mode == 'hang':
    sys.stderr.write('# Tailscale SSH requires an additional check.\n')
    sys.stderr.flush()
    time.sleep(60)
    sys.exit(0)
if mode == 'refuse':
    sys.stderr.write('lelabo@100.76.160.91: Permission denied (tailscale).\n')
    sys.exit(255)
if not os.path.exists(control):
    try:
        socket.socket(socket.AF_UNIX).bind(control)
    except OSError:
        if not os.path.exists(control):
            raise
os.execv(sys.executable, [sys.executable, os.environ['FAKE_DIAL_STDIO']])
`;

// A remote daemon stand-in. The first line selects the behaviour.
const fakeDialStdio = String.raw`import hashlib, os, signal, time

def read_line():
    line = b''
    while not line.endswith(b'\n'):
        byte = os.read(0, 1)
        if not byte:
            break
        line += byte
    return line

first = read_line()
if first.startswith(b'GET /_ping '):
    while read_line() not in (b'\r\n', b''):
        pass
    os.write(1, b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nOK')
elif first == b'DIGEST\n':
    digest = hashlib.sha256()
    size = 0
    while True:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        digest.update(chunk)
        size += len(chunk)
    # Stay silent past the bridge's poll interval after the client half-closes.
    time.sleep(1.5)
    os.write(1, ('sha256=%s bytes=%d\n' % (digest.hexdigest(), size)).encode())
elif first == b'HOLD\n':
    # A signalled OpenSSH mux client ends its session non-zero (255 measured
    # for TERM), which the bridge must not report as an SSH failure.
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda signum, frame: os._exit(255))
    os.write(1, b'READY\n')
    # A silent stream that ignores stdin EOF, like a followed log.
    time.sleep(120)
`;

// Runs as the helper's command and reports what it observed as JSON.
const probe = String.raw`import hashlib, json, os, signal, socket, stat, subprocess, sys, time

LIMIT = int(os.environ['PROBE_LIMIT'])
address = os.environ.get('DOCKER_HOST', '')
path = address[len('unix://'):] if address.startswith('unix://') else ''

def connect():
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(10)
    s.connect(path)
    return s

def read_all(s):
    data = b''
    while True:
        chunk = s.recv(65536)
        if not chunk:
            return data
        data += chunk

def hold():
    s = connect()
    try:
        s.sendall(b'HOLD\n')
        ready = b''
        while len(ready) < 6:
            chunk = s.recv(6 - len(ready))
            if not chunk:
                break
            ready += chunk
    except OSError:
        ready = b''
    return s, ready == b'READY\n'

def wait_forever(marker, ready=None):
    with open(marker + '.partial', 'w') as handle:
        json.dump({'pid': os.getpid(), 'docker_host': address, 'ready': ready}, handle)
    os.rename(marker + '.partial', marker)
    time.sleep(60)

mode = sys.argv[1]
if mode == 'digest':
    payload = os.urandom(1024 * 1024)
    s = connect()
    s.sendall(b'DIGEST\n' + payload)
    s.shutdown(socket.SHUT_WR)
    reply = read_all(s).decode()
    expected = 'sha256=%s bytes=%d\n' % (hashlib.sha256(payload).hexdigest(), len(payload))
    print(json.dumps({
        'docker_host': address,
        'ryuk_disabled': os.environ.get('TESTCONTAINERS_RYUK_DISABLED'),
        'socket_dir_mode': oct(stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode)),
        'reply_matches': reply == expected,
    }))
elif mode == 'limit':
    held = [hold() for _ in range(LIMIT)]
    extra, extra_ready = hold()
    print(json.dumps({
        'all_ready': all(ready for _, ready in held),
        'extra_ready': extra_ready,
    }))
elif mode == 'release':
    held = [hold() for _ in range(LIMIT)]
    held[0][0].close()
    freed = False
    deadline = time.monotonic() + 8
    while not freed and time.monotonic() < deadline:
        s, freed = hold()
        if not freed:
            s.close()
            time.sleep(0.25)
    print(json.dumps({'all_ready': all(ready for _, ready in held), 'freed': freed}))
elif mode == 'abandon':
    # A detached holder keeps the connection open past the command's exit, as a
    # Docker client's keep-alive pool can, so only shutdown ends the session.
    held, ready = hold()
    holder = os.fork()
    if holder == 0:
        devnull = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(devnull, fd)
        time.sleep(60)
        os._exit(0)
    with open(sys.argv[2], 'w') as handle:
        handle.write(str(holder))
    print(json.dumps({'ready': ready}))
elif mode == 'kill-bridge':
    subprocess.run(['/usr/bin/pkill', '-TERM', '-f', path], check=True)
    deadline = time.monotonic() + 5
    while subprocess.run(['/usr/bin/pgrep', '-f', path], stdout=subprocess.DEVNULL).returncode == 0:
        if time.monotonic() > deadline:
            sys.exit(3)
        time.sleep(0.05)
elif mode == 'wait':
    if os.environ.get('PROBE_SLOW_TERM') == '1':
        signal.signal(signal.SIGTERM, lambda signum, frame: (time.sleep(1), os._exit(0)))
    wait_forever(sys.argv[2])
elif mode == 'hold-wait':
    held, ready = hold()
    wait_forever(sys.argv[2], ready)
`;

interface BridgeFixture {
  readonly base: string;
  readonly temporary: string;
  readonly sshLog: string;
  readonly sshPids: string;
  readonly probe: string;
  readonly env: NodeJS.ProcessEnv;
}

interface Waiting {
  readonly pid: number;
  readonly docker_host: string;
  readonly ready: boolean | null;
}

interface RunningHelper {
  readonly child: ChildProcess;
  // 'exit' fires when bash exits; 'close' also waits for every stderr holder.
  readonly exited: Promise<number | null>;
  readonly closed: Promise<number | null>;
  stderr(): string;
}

function makeFixture(): BridgeFixture {
  // A short fixed base keeps TMPDIR under the helper's 69-byte limit wherever
  // the runner's own temporary directory lives.
  const base = mkdtempSync('/tmp/bdb-');
  const temporary = join(base, 't');
  const bin = join(base, 'bin');
  mkdirSync(temporary, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  const ssh = join(bin, 'ssh');
  const dialStdio = join(bin, 'dial-stdio.py');
  const probePath = join(bin, 'probe.py');
  writeFileSync(ssh, fakeSsh, { mode: 0o700 });
  writeFileSync(dialStdio, fakeDialStdio, { mode: 0o600 });
  writeFileSync(probePath, probe, { mode: 0o600 });
  const sshLog = join(base, 'ssh.log');
  const sshPids = join(base, 'ssh.pids');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: base,
    // The macOS default TMPDIR ends with a slash.
    TMPDIR: `${temporary}/`,
    BUDGET_DOCKER_BRIDGE_SSH_BIN: ssh,
    FAKE_SSH_LOG: sshLog,
    FAKE_SSH_PIDS: sshPids,
    FAKE_DIAL_STDIO: dialStdio,
    PROBE_LIMIT: String(connectionLimit),
  };
  delete env.DOCKER_HOST;
  delete env.TESTCONTAINERS_RYUK_DISABLED;
  delete env.BUDGET_DOCKER_BRIDGE_READY_SECONDS;
  return { base, temporary, sshLog, sshPids, probe: probePath, env };
}

function runHelper(
  fixture: BridgeFixture,
  args: readonly string[],
  env: Record<string, string> = {},
): SpawnSyncReturns<string> {
  return spawnSync('/bin/bash', [helper, ...args], {
    encoding: 'utf8',
    env: { ...fixture.env, ...env },
    timeout: 25_000,
  });
}

function startHelper(
  fixture: BridgeFixture,
  args: readonly string[],
  options: { readonly env?: Record<string, string>; readonly detached?: boolean } = {},
): RunningHelper {
  const child = spawn('/bin/bash', [helper, ...args], {
    env: { ...fixture.env, ...options.env },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: options.detached ?? false,
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  const closed = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });
  return { child, exited, closed, stderr: () => stderr };
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline exceeded')), milliseconds);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function probeCommand(fixture: BridgeFixture, ...args: string[]): string[] {
  return ['run', '--', '/usr/bin/python3', fixture.probe, ...args];
}

function readWaiting(marker: string): Waiting {
  return JSON.parse(readFileSync(marker, 'utf8')) as Waiting;
}

function sshInvocations(fixture: BridgeFixture): string[] {
  if (!existsSync(fixture.sshLog)) return [];
  return readFileSync(fixture.sshLog, 'utf8').trimEnd().split('\n');
}

function sshPids(fixture: BridgeFixture): number[] {
  if (!existsSync(fixture.sshPids)) return [];
  return readFileSync(fixture.sshPids, 'utf8').trimEnd().split('\n').map(Number);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function killIfAlive(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function socketPath(dockerHost: string): string {
  expect(dockerHost).toMatch(/^unix:\/\/.+\/docker\.sock$/);
  return dockerHost.slice('unix://'.length);
}

function bridgeDirectory(dockerHost: string): string {
  return socketPath(dockerHost).slice(0, -'/docker.sock'.length);
}

// The bridge is the only process whose argv contains the socket path.
function bridgeAlive(dockerHost: string): boolean {
  const result = spawnSync('/usr/bin/pgrep', ['-f', socketPath(dockerHost)], { encoding: 'utf8' });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`pgrep failed: ${result.stderr}`);
}

function stopLeftovers(fixture: BridgeFixture, running: RunningHelper, waiting?: Waiting): void {
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill('SIGKILL');
  }
  if (waiting !== undefined) {
    killIfAlive(waiting.pid);
    spawnSync('/usr/bin/pkill', ['-KILL', '-f', socketPath(waiting.docker_host)]);
  }
  sshPids(fixture).forEach(killIfAlive);
}

function dialCommand(directory: string): string {
  return [
    '-o BatchMode=yes',
    `-o HostName=${remoteAddress}`,
    '-o ProxyJump=none',
    '-o ProxyCommand=none',
    '-o ConnectTimeout=10',
    '-o ConnectionAttempts=2',
    '-o ServerAliveInterval=15',
    '-o ServerAliveCountMax=2',
    '-o ControlMaster=auto',
    `-o ControlPath=${directory}/ssh`,
    '-o ControlPersist=900',
    remoteHost,
    'docker system dial-stdio',
  ].join(' ');
}

function exitMasterCommand(directory: string): string {
  return `-o ControlPath=${directory}/ssh -O exit ${remoteHost}`;
}

function temporaryRootOfLength(fixture: BridgeFixture, length: number): string {
  const padding = length - fixture.base.length - 1;
  expect(padding).toBeGreaterThan(0);
  const root = join(fixture.base, 'p'.repeat(padding));
  mkdirSync(root, { mode: 0o700 });
  expect(root).toHaveLength(length);
  return root;
}

async function waitFor(condition: () => boolean, milliseconds: number): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met before deadline');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Docker SSH dial-stdio bridge', () => {
  it('refuses a missing subcommand or command before contacting SSH', () => {
    const fixture = makeFixture();

    for (const args of [[], ['run'], ['run', '--'], ['run', 'true'], ['serve', '--', 'true']]) {
      const result = runHelper(fixture, args);

      expect(result.status, args.join(' ')).toBe(64);
      expect(result.stderr).toContain('usage: docker-ssh-bridge.sh run -- COMMAND [ARGUMENT...]');
    }
    expect(sshInvocations(fixture)).toEqual([]);
  });

  it('refuses malformed configuration before contacting SSH', () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'command-ran');
    const cases: Record<string, string>[] = [
      { BUDGET_DOCKER_BRIDGE_READY_SECONDS: '0' },
      { BUDGET_DOCKER_BRIDGE_READY_SECONDS: '121' },
      { BUDGET_DOCKER_BRIDGE_READY_SECONDS: '5s' },
      { BUDGET_DOCKER_BRIDGE_SSH_BIN: 'ssh' },
      { BUDGET_DOCKER_BRIDGE_SSH_BIN: join(fixture.base, 'missing-ssh') },
      { TMPDIR: 'relative/tmp' },
      { TMPDIR: join(fixture.base, 'missing') },
      { TMPDIR: `${fixture.temporary} with space` },
    ];

    for (const env of cases) {
      const result = runHelper(fixture, ['run', '--', '/usr/bin/touch', marker], env);

      expect(result.status, JSON.stringify(env)).toBe(65);
      expect(result.stderr).toMatch(/^budget ops: docker-ssh-bridge: /m);
    }
    expect(existsSync(marker)).toBe(false);
    expect(sshInvocations(fixture)).toEqual([]);
  });

  it('refuses a Testcontainers tc.host setting that would take precedence over DOCKER_HOST', () => {
    const fixture = makeFixture();
    const properties = join(fixture.base, '.testcontainers.properties');
    const marker = join(fixture.base, 'command-ran');
    writeFileSync(properties, 'docker.host=unix:///var/run/docker.sock\ntc.host = tcp://127.0.0.1:2375\n', {
      mode: 0o600,
    });

    const refused = runHelper(fixture, ['run', '--', '/usr/bin/touch', marker]);

    expect(refused.status).toBe(65);
    expect(refused.stderr).toContain('sets tc.host');
    expect(existsSync(marker)).toBe(false);
    expect(sshInvocations(fixture)).toEqual([]);

    // DOCKER_HOST in the environment already overrides the file's docker.host.
    writeFileSync(properties, 'docker.host=unix:///var/run/docker.sock\n', { mode: 0o600 });
    const accepted = runHelper(fixture, ['run', '--', '/usr/bin/touch', marker]);

    expect(accepted.status, accepted.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('refuses a temporary directory whose SSH control socket would reach 104 bytes', () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'command-ran');

    const tooLong = runHelper(fixture, ['run', '--', '/usr/bin/touch', marker], {
      TMPDIR: temporaryRootOfLength(fixture, 70),
    });

    expect(tooLong.status).toBe(65);
    expect(tooLong.stderr).toContain('SSH control socket path would be 104 bytes');
    expect(existsSync(marker)).toBe(false);
    expect(sshInvocations(fixture)).toEqual([]);

    const longest = runHelper(fixture, ['run', '--', '/usr/bin/touch', marker], {
      TMPDIR: temporaryRootOfLength(fixture, 69),
    });

    expect(longest.status, longest.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('relays a half-closed request and its delayed response through dial-stdio', () => {
    const fixture = makeFixture();

    const result = runHelper(fixture, probeCommand(fixture, 'digest'));

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(report.reply_matches).toBe(true);
    expect(report.ryuk_disabled).toBe('true');
    expect(report.socket_dir_mode).toBe('0o700');
    expect(bridgeDirectory(String(report.docker_host)).startsWith(`${fixture.temporary}/`)).toBe(
      true,
    );
  });

  it('dials only the pinned address through one batch-mode multiplexed SSH master', () => {
    const fixture = makeFixture();

    const result = runHelper(fixture, probeCommand(fixture, 'digest'));

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { docker_host: string };
    const directory = bridgeDirectory(report.docker_host);
    // One readiness ping, one probe connection, then the master is told to exit.
    expect(sshInvocations(fixture)).toEqual([
      dialCommand(directory),
      dialCommand(directory),
      exitMasterCommand(directory),
    ]);
  });

  it('returns the command status and leaves no socket, master, or SSH process behind', () => {
    const fixture = makeFixture();

    const result = runHelper(fixture, ['run', '--', '/bin/sh', '-c', 'exit 7']);

    expect(result.status, result.stderr).toBe(7);
    expect(readdirSync(fixture.temporary)).toEqual([]);
    expect(sshInvocations(fixture).at(-1)).toMatch(/ -O exit lelabo@100\.76\.160\.91$/);
    expect(sshPids(fixture).length).toBeGreaterThan(0);
    expect(sshPids(fixture).filter(isAlive)).toEqual([]);
  });

  it('exits 70 when cleanup fails after a successful command', () => {
    const fixture = makeFixture();

    const result = runHelper(fixture, ['run', '--', '/usr/bin/true'], { FAKE_SSH_EXIT_FAILS: '1' });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain('SSH master did not accept the exit request');
  });

  it('fails loudly instead of hanging when the SSH session never answers', () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'command-ran');
    const startedAt = Date.now();

    const result = runHelper(fixture, ['run', '--', '/usr/bin/touch', marker], {
      FAKE_SSH_MODE: 'hang',
      BUDGET_DOCKER_BRIDGE_READY_SECONDS: '2',
    });

    expect(result.status).toBe(66);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(result.stderr).toContain(`remote Docker did not answer /_ping through ${remoteHost} within 2s`);
    expect(result.stderr).toContain('re-authenticate Tailscale');
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(fixture.temporary)).toEqual([]);
    expect(sshPids(fixture).length).toBeGreaterThan(0);
    expect(sshPids(fixture).filter(isAlive)).toEqual([]);
  });

  it('fails fast and passes SSH diagnostics through when SSH refuses the session', () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'command-ran');
    const startedAt = Date.now();

    const result = runHelper(fixture, ['run', '--', '/usr/bin/touch', marker], {
      FAKE_SSH_MODE: 'refuse',
      BUDGET_DOCKER_BRIDGE_READY_SECONDS: '20',
    });

    expect(result.status).toBe(66);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(result.stderr).toContain('Permission denied (tailscale).');
    expect(result.stderr).toContain('ssh exited with status 255');
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(fixture.temporary)).toEqual([]);
  });

  it(`refuses connections beyond ${connectionLimit} open bridged connections`, () => {
    const fixture = makeFixture();

    const result = runHelper(fixture, probeCommand(fixture, 'limit'));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ all_ready: true, extra_ready: false });
    expect(result.stderr).toContain(`connection limit (${connectionLimit}) reached`);
    expect(sshPids(fixture).filter(isAlive)).toEqual([]);
  });

  it('frees a connection slot when a client disconnects from a silent stream', () => {
    const fixture = makeFixture();

    const result = runHelper(fixture, probeCommand(fixture, 'release'));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ all_ready: true, freed: true });
  });

  it('does not report SSH sessions it stops at shutdown as SSH failures', () => {
    const fixture = makeFixture();
    const holderPid = join(fixture.base, 'holder.pid');

    try {
      const result = runHelper(fixture, probeCommand(fixture, 'abandon', holderPid));

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ready: true });
      expect(result.stderr).not.toContain('ssh exited with status');
      expect(sshPids(fixture).filter(isAlive)).toEqual([]);
    } finally {
      if (existsSync(holderPid)) killIfAlive(Number(readFileSync(holderPid, 'utf8')));
    }
  });

  it('fails when the bridge exits while the command runs', () => {
    const fixture = makeFixture();

    const result = runHelper(fixture, probeCommand(fixture, 'kill-bridge'));

    expect(result.status).toBe(66);
    expect(result.stderr).toContain('bridge exited while the command ran');
  });

  it('runs the command with the caller PATH rather than the utility allowlist', () => {
    const fixture = makeFixture();
    const callerBin = join(fixture.base, 'caller-bin');
    const report = join(fixture.base, 'caller-path');
    mkdirSync(callerBin, { mode: 0o700 });
    writeFileSync(
      join(callerBin, 'budget-caller-command'),
      '#!/bin/sh\nprintf "%s" "$PATH" > "$CALLER_PATH_REPORT"\n',
      { mode: 0o700 },
    );
    const callerPath = `${callerBin}:/usr/bin:/bin`;

    const result = runHelper(fixture, ['run', '--', 'budget-caller-command'], {
      PATH: callerPath,
      CALLER_PATH_REPORT: report,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(report, 'utf8')).toBe(callerPath);
  });

  it('checks readiness without reading the operator curl configuration', () => {
    const fixture = makeFixture();
    writeFileSync(join(fixture.base, '.curlrc'), 'output = "/dev/null"\n', { mode: 0o600 });

    const result = runHelper(fixture, ['run', '--', '/usr/bin/true']);

    expect(result.status, result.stderr).toBe(0);
  });

  it('starts the bridge without importing modules from the working directory', () => {
    const fixture = makeFixture();
    const shadow = join(fixture.base, 'shadow');
    mkdirSync(shadow, { mode: 0o700 });
    writeFileSync(join(shadow, 'socket.py'), 'raise SystemExit("shadow socket module imported")\n');

    const result = spawnSync('/bin/bash', [helper, 'run', '--', '/usr/bin/true'], {
      cwd: shadow,
      encoding: 'utf8',
      env: fixture.env,
      timeout: 25_000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('shadow socket module imported');
  });

  it('stops the command, bridge, and SSH master when interrupted', async () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'waiting.json');
    const running = startHelper(fixture, probeCommand(fixture, 'wait', marker));
    let waiting: Waiting | undefined;

    try {
      await waitFor(() => existsSync(marker), 15_000);
      waiting = readWaiting(marker);
      running.child.kill('SIGTERM');

      expect(await within(running.closed, 20_000), running.stderr()).toBe(143);
      expect(isAlive(waiting.pid)).toBe(false);
      expect(bridgeAlive(waiting.docker_host)).toBe(false);
      expect(readdirSync(fixture.temporary)).toEqual([]);
      expect(sshInvocations(fixture).at(-1)).toBe(
        exitMasterCommand(bridgeDirectory(waiting.docker_host)),
      );
      expect(sshPids(fixture).filter(isAlive)).toEqual([]);
    } finally {
      stopLeftovers(fixture, running, waiting);
    }
  });

  it('ignores a second interrupt while it cleans up', async () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'waiting.json');
    const running = startHelper(fixture, probeCommand(fixture, 'wait', marker), {
      env: { PROBE_SLOW_TERM: '1' },
    });
    let waiting: Waiting | undefined;

    try {
      await waitFor(() => existsSync(marker), 15_000);
      waiting = readWaiting(marker);
      running.child.kill('SIGTERM');
      // The command takes a second to stop, so this lands during cleanup.
      await new Promise((resolve) => setTimeout(resolve, 300));
      running.child.kill('SIGTERM');

      expect(await within(running.closed, 20_000), running.stderr()).toBe(143);
      expect(bridgeAlive(waiting.docker_host)).toBe(false);
      expect(readdirSync(fixture.temporary)).toEqual([]);
      expect(sshPids(fixture).filter(isAlive)).toEqual([]);
    } finally {
      stopLeftovers(fixture, running, waiting);
    }
  });

  it('finishes cleanup when interrupted after the command succeeds', async () => {
    const fixture = makeFixture();
    const exitRequested = join(fixture.base, 'exit-requested');
    const running = startHelper(fixture, ['run', '--', '/usr/bin/true'], {
      env: { FAKE_SSH_EXIT_MARKER: exitRequested },
    });

    try {
      await waitFor(() => existsSync(exitRequested), 15_000);
      running.child.kill('SIGTERM');

      expect(await within(running.closed, 20_000), running.stderr()).toBe(0);
      expect(readdirSync(fixture.temporary)).toEqual([]);
    } finally {
      stopLeftovers(fixture, running);
    }
  });

  it('keeps SSH sessions out of a terminal interrupt so they are not reported as failures', async () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'waiting.json');
    const running = startHelper(fixture, probeCommand(fixture, 'hold-wait', marker), {
      detached: true,
    });
    let waiting: Waiting | undefined;

    try {
      await waitFor(() => existsSync(marker), 15_000);
      waiting = readWaiting(marker);
      expect(waiting.ready).toBe(true);
      const processGroup = running.child.pid;
      if (processGroup === undefined) throw new Error('helper has no pid');
      // A terminal Ctrl-C signals the whole foreground process group.
      process.kill(-processGroup, 'SIGINT');

      expect(await within(running.closed, 20_000), running.stderr()).toBe(130);
      expect(running.stderr()).not.toContain('ssh exited with status');
      expect(bridgeAlive(waiting.docker_host)).toBe(false);
      expect(readdirSync(fixture.temporary)).toEqual([]);
      expect(sshPids(fixture).filter(isAlive)).toEqual([]);
    } finally {
      stopLeftovers(fixture, running, waiting);
    }
  });

  it('stops the bridge and its SSH sessions when the helper is killed', async () => {
    const fixture = makeFixture();
    const marker = join(fixture.base, 'waiting.json');
    const running = startHelper(fixture, probeCommand(fixture, 'hold-wait', marker));
    let waiting: Waiting | undefined;

    try {
      await waitFor(() => existsSync(marker), 15_000);
      waiting = readWaiting(marker);
      const dockerHost = waiting.docker_host;
      running.child.kill('SIGKILL');
      await within(running.exited, 5_000);

      await waitFor(() => !bridgeAlive(dockerHost), 5_000);
      await waitFor(() => sshPids(fixture).filter(isAlive).length === 0, 5_000);
    } finally {
      stopLeftovers(fixture, running, waiting);
    }
  });

  it('is syntax-checked by the ops gate', () => {
    const opsCheck = readFileSync('scripts/ops/check-budget.sh', 'utf8');

    expect(opsCheck).toContain('"${CHECK_SCRIPT_DIR}/docker-ssh-bridge.sh"');
  });
});
