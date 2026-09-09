#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly BUDGET_COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly BUDGET_OPS_REPO_ROOT="$(cd "${BUDGET_COMMON_SCRIPT_DIR}/../.." && pwd -P)"
readonly BUDGET_MAX_SCAN_FILES=256
readonly BUDGET_MAX_SCAN_BYTES=10485760

budget_error() {
  local message="${1:?error message is required}"
  local status="${2:-1}"
  printf '%s\n' "budget ops: ${message}" >&2
  return "${status}"
}

budget_monotonic_seconds() {
  /usr/bin/perl -MTime::HiRes=clock_gettime,CLOCK_MONOTONIC -e '
    alarm 5;
    printf "%d\n", int(clock_gettime(CLOCK_MONOTONIC));
  '
}

budget_start_deadline() {
  local total_seconds="${1:-}"
  local started_at
  [[ "${total_seconds}" =~ ^[1-9][0-9]{0,5}$ ]] || return 1
  started_at="$(budget_monotonic_seconds)"
  printf '%s\n' "$((started_at + total_seconds))"
}

budget_start_cleanup_deadline() {
  local status="${1:?status is required}"
  local deadline
  if ! deadline="$(budget_start_deadline 5)"; then
    budget_error 'cleanup deadline unavailable' "${status}"
    return
  fi
  printf '%s\n' "${deadline}"
}

budget_remaining_seconds() {
  local deadline="${1:?deadline is required}"
  local now remaining
  now="$(budget_monotonic_seconds)"
  remaining=$((deadline - now))
  (( remaining > 0 )) || return 1
  printf '%s\n' "${remaining}"
}

budget_run_before_deadline() {
  local deadline="${1:?deadline is required}"
  local status="${2:?status is required}"
  local timeout_bin="${3:?timeout binary is required}"
  shift 3
  local remaining
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    budget_error 'whole-operation deadline exceeded' "${status}"
    return
  fi
  "${timeout_bin}" "${remaining}" "$@"
}

budget_run_internal_before_deadline() {
  local deadline="${1:?deadline is required}"
  local status="${2:?status is required}"
  shift 2
  local remaining
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    budget_error 'whole-operation deadline exceeded' "${status}"
    return
  fi
  if ! /usr/bin/perl -e 'alarm shift @ARGV; exec @ARGV or die "exec failed\n"' \
    "${remaining}" "$@"; then
    budget_error 'bounded validation command failed' "${status}"
  fi
}

budget_create_executable_snapshot_dir() {
  local deadline="${1:?deadline is required}"
  local status="${2:?status is required}"
  local remaining snapshot_dir
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    budget_error 'whole-operation deadline exceeded' "${status}"
    return
  fi
  if ! snapshot_dir="$(/usr/bin/perl -MCwd=abs_path -MFile::Temp=tempdir -e '
    alarm shift @ARGV;
    my $directory = tempdir("budget-ops-exec-XXXXXXXX", DIR => "/tmp", CLEANUP => 0);
    chmod 0700, $directory or die "chmod\n";
    my $canonical = abs_path($directory);
    die "canonical\n" unless defined $canonical;
    print "$canonical\n";
  ' "${remaining}")"; then
    budget_error 'executable snapshot directory creation failed' "${status}"
    return
  fi
  printf '%s\n' "${snapshot_dir}"
}

budget_snapshot_executable() {
  local source="${1:-}"
  local expected_hash="${2:-}"
  local destination="${3:-}"
  local deadline="${4:?deadline is required}"
  local status="${5:?status is required}"
  local remaining
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    budget_error 'whole-operation deadline exceeded' "${status}"
    return
  fi
  if [[ ! "${expected_hash}" =~ ^[a-f0-9]{64}$ ]] || \
    ! /usr/bin/perl -MCwd=abs_path -MDigest::SHA -MFcntl=:DEFAULT,O_NOFOLLOW,:mode -e '
      use strict;
      use warnings;
      my ($seconds, $source, $destination, $expected_hash) = @ARGV;
      alarm $seconds;
      my @before = lstat($source);
      die "source\n" unless @before && S_ISREG($before[2]);
      die "owner\n" unless ($before[4] == $< || $before[4] == 0);
      die "mode\n" unless ($before[2] & 0111) && !(($before[2] & 0022));
      die "size\n" unless $before[7] > 0 && $before[7] <= 104_857_600;
      my $resolved = abs_path($source);
      die "path\n" unless defined $resolved && $resolved eq $source;
      die "placeholder\n" if $resolved =~ m{^/(?:usr/)?bin/(?:true|false)$};
      sysopen(my $input, $source, O_RDONLY | O_NOFOLLOW) or die "open source\n";
      my @opened = stat($input);
      die "swap\n" unless @opened && S_ISREG($opened[2]);
      die "swap\n" unless $opened[0] == $before[0] && $opened[1] == $before[1];
      sysopen(my $output, $destination, O_WRONLY | O_CREAT | O_EXCL, 0500)
        or die "open destination\n";
      my $digest = Digest::SHA->new(256);
      my $buffer;
      while (1) {
        my $count = sysread($input, $buffer, 65_536);
        die "read\n" unless defined $count;
        last if $count == 0;
        $digest->add(substr($buffer, 0, $count));
        my $offset = 0;
        while ($offset < $count) {
          my $written = syswrite($output, $buffer, $count - $offset, $offset);
          die "write\n" unless defined $written && $written > 0;
          $offset += $written;
        }
      }
      close $output or die "close\n";
      die "hash\n" unless $digest->hexdigest eq $expected_hash;
    ' "${remaining}" "${source}" "${destination}" "${expected_hash}" 2>/dev/null; then
    budget_error 'executable snapshot validation failed' "${status}"
    return
  fi
  printf '%s\n' "${destination}"
}

budget_seal_executable_snapshot_dir() {
  local directory="${1:-}"
  local status="${2:?status is required}"
  if [[ ! "${directory}" =~ ^/(private/)?tmp/budget-ops-exec-[A-Za-z0-9_]{8}$ ]] || \
    ! /bin/chmod 0500 "${directory}"; then
    budget_error 'executable snapshot directory sealing failed' "${status}"
  fi
}

budget_remove_private_descendant() {
  local root="${1:-}"
  local relative="${2:-}"
  local deadline="${3:?deadline is required}"
  local status="${4:?status is required}"
  local root_policy="${5:-private}"
  local entry_policy="${6:-artifact}"
  local remaining
  if [[ "${root}" != /* || -z "${relative}" || ${#relative} -gt 512 || \
    ! "${relative}" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}){0,7}$ || \
    ! "${root_policy}" =~ ^(private|sticky-tmp)$ || \
    ! "${entry_policy}" =~ ^(artifact|executable)$ ]]; then
    budget_error 'unsafe bounded cleanup target' "${status}"
    return
  fi
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    budget_error 'cleanup deadline exceeded' "${status}"
    return
  fi
  if ! /usr/bin/python3 -c '
import os
import re
import signal
import stat
import sys

seconds, root, relative, root_policy, entry_policy = sys.argv[1:]
signal.alarm(int(seconds))
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
opened = []

def private_directory(details):
    return (
        stat.S_ISDIR(details.st_mode)
        and details.st_uid == os.geteuid()
        and not details.st_mode & 0o077
    )

try:
    root_before = os.lstat(root)
    if os.path.realpath(root) != root:
        raise RuntimeError("root")
    if root_policy == "private":
        if not private_directory(root_before):
            raise RuntimeError("root")
    elif (
        root not in ("/tmp", "/private/tmp")
        or root_before.st_uid != 0
        or root_before.st_mode & 0o1777 != 0o1777
    ):
        raise RuntimeError("root")
    root_fd = os.open(root, flags)
    opened.append(root_fd)
    root_after = os.fstat(root_fd)
    if (root_after.st_dev, root_after.st_ino) != (
        root_before.st_dev,
        root_before.st_ino,
    ):
        raise RuntimeError("root")
    parent_fd = root_fd
    parts = relative.split("/")
    for position, part in enumerate(parts):
        child_fd = os.open(part, flags, dir_fd=parent_fd)
        opened.append(child_fd)
        child = os.fstat(child_fd)
        if not private_directory(child):
            raise RuntimeError("directory")
        if position == len(parts) - 1:
            target_fd = child_fd
            target_name = part
            target_identity = (child.st_dev, child.st_ino)
        else:
            parent_fd = child_fd
    entries = os.listdir(target_fd)
    if len(entries) > 32:
        raise RuntimeError("entries")
    pattern = (
        r"exec-[0-9]{2}-[A-Za-z0-9._-]{1,64}"
        if entry_policy == "executable"
        else r"[A-Za-z0-9._:-]{1,128}"
    )
    os.fchmod(target_fd, 0o700)
    for entry in entries:
        if entry in (".", "..") or re.fullmatch(pattern, entry) is None:
            raise RuntimeError("entry")
        details = os.stat(entry, dir_fd=target_fd, follow_symlinks=False)
        if stat.S_ISDIR(details.st_mode):
            raise RuntimeError("nested")
        os.unlink(entry, dir_fd=target_fd)
    if os.listdir(target_fd):
        raise RuntimeError("remaining")
    named = os.stat(target_name, dir_fd=parent_fd, follow_symlinks=False)
    if (named.st_dev, named.st_ino) != target_identity:
        raise RuntimeError("swap")
    os.rmdir(target_name, dir_fd=parent_fd)
finally:
    for descriptor in reversed(opened):
        os.close(descriptor)
  ' "${remaining}" "${root}" "${relative}" "${root_policy}" "${entry_policy}" \
    2>/dev/null; then
    budget_error 'bounded private cleanup failed' "${status}"
    return
  fi
}

budget_cleanup_executable_snapshot_dir() {
  local directory="${1:-}"
  local deadline="${2:-}"
  local status="${3:-66}"
  local root relative
  [[ "${directory}" =~ ^/(private/)?tmp/budget-ops-exec-[A-Za-z0-9_]{8}$ ]] || return 0
  if [[ -z "${deadline}" ]] && ! deadline="$(budget_start_cleanup_deadline "${status}")"; then
    return
  fi
  root="${directory%/*}"
  relative="${directory##*/}"
  budget_remove_private_descendant "${root}" "${relative}" "${deadline}" \
    "${status}" sticky-tmp executable
}

budget_file_sha256() {
  local candidate="${1:-}"
  local deadline="${2:?deadline is required}"
  local status="${3:?status is required}"
  local output
  output="$(budget_run_internal_before_deadline "${deadline}" "${status}" \
    /usr/bin/shasum -a 256 "${candidate}")" || return
  printf '%s\n' "${output%% *}"
}

budget_validate_executable_hash() {
  local candidate="${1:-}"
  local expected_hash="${2:-}"
  local status="${3:-70}"
  local deadline="${4:?deadline is required}"
  local actual_hash

  if [[ "${candidate}" != /* || ! -f "${candidate}" || ! -x "${candidate}" || \
    ! "${expected_hash}" =~ ^[a-f0-9]{64}$ ]]; then
    budget_error 'PostgreSQL executable contract is invalid' "${status}"
    return
  fi
  actual_hash="$(budget_file_sha256 "${candidate}" "${deadline}" "${status}")"
  if [[ "${actual_hash}" != "${expected_hash}" ]]; then
    budget_error 'PostgreSQL executable hash mismatch' "${status}"
    return
  fi
}

budget_validate_postgres_binary() {
  local candidate="${1:-}"
  local expected_hash="${2:-}"
  local product="${3:-}"
  local expected_version="${4:-}"
  local status="${5:-70}"
  local deadline="${6:?deadline is required}"
  local version_output

  budget_validate_executable_hash "${candidate}" "${expected_hash}" "${status}" \
    "${deadline}"
  version_output="$(budget_run_internal_before_deadline "${deadline}" "${status}" \
    "${candidate}" --version)"
  if [[ "${version_output}" != "${product} (PostgreSQL) ${expected_version}" && \
    "${version_output}" != "${product} (PostgreSQL) ${expected_version} "* ]]; then
    budget_error 'measured PostgreSQL version mismatch' "${status}"
  fi
}

budget_validate_source_commit() {
  local expected="${1:-}"
  local status="${2:-70}"
  local deadline="${3:?deadline is required}"
  local actual
  if [[ ! "${expected}" =~ ^[a-f0-9]{40}$ ]]; then
    budget_error 'source commit provenance is invalid' "${status}"
    return
  fi
  actual="$(budget_run_internal_before_deadline "${deadline}" "${status}" \
    /usr/bin/git -C "${BUDGET_OPS_REPO_ROOT}" rev-parse HEAD)"
  if [[ "${actual}" != "${expected}" ]]; then
    budget_error 'source commit provenance mismatch' "${status}"
  fi
}

budget_is_protected_identifier() {
  local value="${1:-}"
  local lowered
  lowered="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  [[ "${lowered}" =~ (^|[^[:alnum:]])(sandooq|pos)([^[:alnum:]]|$) ]]
}

budget_validate_offsite_destination() {
  local destination="${1:-}"
  local allowed_prefix="${2:-}"
  local status="${3:-70}"

  if [[ -z "${destination}" || ${#destination} -gt 256 || \
    -z "${allowed_prefix}" || ${#allowed_prefix} -gt 128 || \
    "${destination}" != "${allowed_prefix}" || \
    ! "${destination}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ || \
    ! "${allowed_prefix}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || \
    budget_is_protected_identifier "${destination}"; then
    budget_error 'off-site destination is outside the exact allowlist' "${status}"
  fi
}

budget_assert_offsite_receipt() {
  local receipt="${1:-}"
  local expected_provider="${2:-}"
  local expected_key="${3:-}"
  local expected_size="${4:-}"
  local expected_hash="${5:-}"
  local status="${6:-70}"
  local version provider object_key object_version remote_size remote_hash immutable monitoring extra

  IFS='|' read -r version provider object_key object_version remote_size remote_hash \
    immutable monitoring extra <<< "${receipt}"
  if [[ -z "${receipt}" || ${#receipt} -gt 1024 || \
    "${receipt}" =~ [[:cntrl:]] || "${version}" != 'receipt_version=1' || \
    "${provider}" != "provider=${expected_provider}" || \
    "${object_key}" != "object_key=${expected_key}" || \
    ! "${object_version}" =~ ^object_version=[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ || \
    "${remote_size}" != "remote_size=${expected_size}" || \
    "${remote_hash}" != "remote_sha256=${expected_hash}" || \
    "${immutable}" != 'immutable=1' || "${monitoring}" != 'monitoring=1' || \
    -n "${extra}" || ! "${expected_provider}" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ || \
    ! "${expected_key}" =~ ^[A-Za-z0-9TZ:._-]{1,128}/[A-Za-z0-9._-]{1,64}$ || \
    ! "${expected_size}" =~ ^[0-9]{1,20}$ || \
    ! "${expected_hash}" =~ ^[a-f0-9]{64}$ ]]; then
    budget_error 'off-site receipt is invalid' "${status}"
    return
  fi
  printf '%s\n' "${receipt}"
}

budget_assert_comparison_receipt() {
  local receipt="${1:-}"
  local expected_manifest_hash="${2:-}"
  local expected_catalog_hash="${3:-}"
  local status="${4:-78}"
  local version comparison_status target manifest_hash catalog_hash extra

  IFS='|' read -r version comparison_status target manifest_hash catalog_hash extra <<< "${receipt}"
  if [[ -z "${receipt}" || ${#receipt} -gt 512 || \
    "${receipt}" =~ [[:cntrl:]] || "${version}" != 'comparison_version=1' || \
    "${comparison_status}" != 'status=verified' || "${target}" != 'target=scratch' || \
    "${manifest_hash}" != "manifest_sha256=${expected_manifest_hash}" || \
    "${catalog_hash}" != "catalog_sha256=${expected_catalog_hash}" || \
    -n "${extra}" || ! "${expected_manifest_hash}" =~ ^[a-f0-9]{64}$ || \
    ! "${expected_catalog_hash}" =~ ^[a-f0-9]{64}$ ]]; then
    budget_error 'comparison receipt is invalid' "${status}"
    return
  fi
  printf '%s\n' "${receipt}"
}

budget_validate_safe_path() {
  local path="${1:-}"
  local expected_basename="${2:-}"
  local trusted_parent="${3:-}"

  if [[ -z "${path}" || "${path}" != /* || "${path}" == '/' || \
    "${path}" == '/home/lelabo' || "${path}" == '~' || \
    "${path}" == "${HOME:-__unset_home__}" || \
    "${path}" == "${BUDGET_OPS_REPO_ROOT}" || -z "${trusted_parent}" || \
    "${trusted_parent}" != /* || \
    "${path}" == *'$'* || "${path}" == *'{'* || "${path}" == *'}'* || \
    "${path}" == *'*'* || "${path}" == *'?'* || "${path}" == *'['* || \
    "${path}" == *'/../'* || "${path}" == */.. || \
    "${path}" == *$'\n'* || "${trusted_parent}" == *$'\n'* ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi

  if [[ -n "${expected_basename}" && "${path##*/}" != "${expected_basename}" ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi

  if ! /usr/bin/perl -MCwd=abs_path -MFcntl=:mode -e '
    alarm 5;
    my ($path, $trusted_parent, $expected_basename) = @ARGV;
    my $resolved_path = abs_path($path);
    my $resolved_parent = abs_path($trusted_parent);
    exit 1 unless defined $resolved_path && defined $resolved_parent;
    exit 1 unless $resolved_path eq $path && $resolved_parent eq $trusted_parent;
    exit 1 unless index($path, "$trusted_parent/") == 0;
    my $relative = substr($path, length($trusted_parent) + 1);
    my @parts = split m{/}, $relative, -1;
    exit 1 unless @parts && $parts[-1] eq $expected_basename;
    my $cursor = $trusted_parent;
    for my $part ("", @parts) {
      if (length $part) {
        exit 1 if $part eq "." || $part eq ".." || !length $part;
        $cursor .= "/$part";
      }
      my @details = lstat($cursor);
      exit 1 unless @details && S_ISDIR($details[2]);
      exit 1 unless $details[4] == $<;
      exit 1 unless (($details[2] & 0077) == 0);
    }
  ' "${path}" "${trusted_parent}" "${expected_basename}"; then
    budget_error 'unsafe Budget root' 66
    return
  fi

  printf '%s\n' "${path}"
}

budget_private_descendant() {
  local root="${1:-}"
  local relative="${2:-}"
  local create_missing="${3:-0}"
  local deadline="${4:?deadline is required}"
  local status="${5:?status is required}"
  local remaining
  if [[ "${root}" != /* || -z "${relative}" || ${#relative} -gt 512 || \
    ! "${relative}" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}){0,7}$ || \
    ( "${create_missing}" != '0' && "${create_missing}" != '1' ) ]]; then
    budget_error 'unsafe Budget descendant' "${status}"
    return
  fi
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    budget_error 'whole-operation deadline exceeded' "${status}"
    return
  fi
  if ! /usr/bin/perl -MCwd=abs_path -MFcntl=:mode -e '
    use strict;
    use warnings;
    my ($seconds, $root, $relative, $create_missing) = @ARGV;
    alarm $seconds;
    my @root_details = lstat($root);
    die "root\n" unless @root_details && S_ISDIR($root_details[2]);
    die "root\n" unless $root_details[4] == $< && !(($root_details[2] & 0077));
    my $resolved_root = abs_path($root);
    die "root\n" unless defined $resolved_root && $resolved_root eq $root;
    my @parts = split m{/}, $relative, -1;
    die "depth\n" unless @parts && @parts <= 8;
    my $cursor = $root;
    for my $part (@parts) {
      $cursor .= "/$part";
      my @details = lstat($cursor);
      if (!@details && $create_missing eq "1") {
        mkdir($cursor, 0700) or die "mkdir\n";
        @details = lstat($cursor);
      }
      die "directory\n" unless @details && S_ISDIR($details[2]);
      die "owner\n" unless $details[4] == $< && !(($details[2] & 0077));
      my $resolved = abs_path($cursor);
      die "path\n" unless defined $resolved && $resolved eq $cursor;
    }
    print "$cursor\n";
  ' "${remaining}" "${root}" "${relative}" "${create_missing}" 2>/dev/null; then
    budget_error 'unsafe Budget descendant' "${status}"
    return
  fi
}

budget_ensure_private_descendant() {
  budget_private_descendant "$1" "$2" 1 "$3" "$4"
}

budget_validate_private_descendant() {
  budget_private_descendant "$1" "$2" 0 "$3" "$4"
}

budget_read_private_marker() {
  local marker="${1:-}"
  local status="${2:-67}"
  local unsafe_message="${3:-environment marker is unsafe}"

  if [[ -z "${marker}" || ( ! -e "${marker}" && ! -L "${marker}" ) ]]; then
    return 2
  fi
  if ! /usr/bin/perl -MFcntl=:DEFAULT,O_NOFOLLOW,:mode -e '
    alarm 5;
    my ($path) = @ARGV;
    my @before = lstat($path);
    exit 1 unless @before && S_ISREG($before[2]);
    exit 1 unless $before[4] == $< && (($before[2] & 0777) == 0600);
    exit 1 unless $before[7] <= 4096;
    sysopen(my $handle, $path, O_RDONLY | O_NOFOLLOW) or exit 1;
    my @opened = stat($handle);
    exit 1 unless @opened && $opened[0] == $before[0] && $opened[1] == $before[1];
    exit 1 unless S_ISREG($opened[2]);
    exit 1 unless $opened[4] == $< && (($opened[2] & 0777) == 0600);
    exit 1 unless $opened[7] <= 4096;
    local $/;
    my $contents = <$handle>;
    exit 1 unless defined $contents && length($contents) <= 4096;
    print $contents;
  ' "${marker}"; then
    budget_error "${unsafe_message}" "${status}"
    return
  fi
}

budget_snapshot_private_file() {
  local source="${1:-}"
  local destination="${2:-}"
  local max_bytes="${3:-}"
  local deadline="${4:?deadline is required}"
  local status="${5:-1}"
  local remaining
  if [[ "${source}" != /* || "${destination}" != /* || \
    ! "${max_bytes}" =~ ^[1-9][0-9]{0,7}$ || "${max_bytes}" -gt 10485760 ]]; then
    budget_error 'private input snapshot contract is invalid' "${status}"
    return
  fi
  if ! remaining="$(budget_remaining_seconds "${deadline}")"; then
    budget_error 'whole-operation deadline exceeded' "${status}"
    return
  fi
  if ! /usr/bin/perl -MFcntl=:DEFAULT,O_NOFOLLOW,:mode -e '
    use strict;
    use warnings;
    my ($seconds, $source, $destination, $max_bytes) = @ARGV;
    alarm $seconds;
    my @before = lstat($source);
    die "source\n" unless @before && S_ISREG($before[2]);
    die "owner\n" unless $before[4] == $< && (($before[2] & 0777) == 0600);
    die "size\n" unless $before[7] > 0 && $before[7] <= $max_bytes;
    sysopen(my $input, $source, O_RDONLY | O_NOFOLLOW) or die "open source\n";
    my @opened = stat($input);
    die "swap\n" unless @opened && S_ISREG($opened[2]);
    die "swap\n" unless $opened[0] == $before[0] && $opened[1] == $before[1];
    die "swap\n" unless $opened[4] == $< && (($opened[2] & 0777) == 0600);
    die "swap\n" unless $opened[7] > 0 && $opened[7] <= $max_bytes;
    sysopen(my $output, $destination, O_WRONLY | O_CREAT | O_EXCL, 0400)
      or die "open destination\n";
    my $total = 0;
    my $buffer;
    while (1) {
      my $count = sysread($input, $buffer, 65_536);
      die "read\n" unless defined $count;
      last if $count == 0;
      $total += $count;
      die "size\n" if $total > $max_bytes;
      my $offset = 0;
      while ($offset < $count) {
        my $written = syswrite($output, $buffer, $count - $offset, $offset);
        die "write\n" unless defined $written && $written > 0;
        $offset += $written;
      }
    }
    die "size\n" unless $total == $before[7];
    close $output or die "close\n";
  ' "${remaining}" "${source}" "${destination}" "${max_bytes}" 2>/dev/null; then
    budget_error 'private input snapshot validation failed' "${status}"
    return
  fi
  printf '%s\n' "${destination}"
}

budget_require_private_artifact() {
  local path="${1:-}"
  local status="${2:-1}"
  if [[ -z "${path}" ]] || ! /usr/bin/perl -MFcntl=:DEFAULT,O_NOFOLLOW,:mode -e '
    alarm 5;
    my @before = lstat($ARGV[0]);
    exit 1 unless @before && S_ISREG($before[2]);
    exit 1 unless $before[4] == $< && (($before[2] & 0077) == 0) && $before[7] > 0;
    sysopen(my $handle, $ARGV[0], O_RDONLY | O_NOFOLLOW) or exit 1;
    my @opened = stat($handle);
    exit 1 unless @opened && S_ISREG($opened[2]);
    exit 1 unless $opened[0] == $before[0] && $opened[1] == $before[1];
  ' "${path}"; then
    budget_error 'generated recovery artifact is unsafe or empty' "${status}"
  fi
}

budget_expected_project() {
  case "${1:-}" in
    development) printf '%s\n' 'budget-supabase' ;;
    uat) printf '%s\n' 'budget-uat' ;;
    live) printf '%s\n' 'budget-live' ;;
    *) return 1 ;;
  esac
}

budget_expected_port_range() {
  case "${1:-}" in
    development) printf '%s\n' '54420-54429' ;;
    uat) printf '%s\n' '54520-54529' ;;
    live) printf '%s\n' '54620-54629' ;;
    *) return 1 ;;
  esac
}

budget_validate_environment() {
  local environment="${BUDGET_ENV:-}"
  local root="${BUDGET_ROOT:-}"
  local marker="${BUDGET_MARKER_PATH:-}"
  local project="${BUDGET_PROJECT_ID:-}"
  local hostname="${BUDGET_HOSTNAME:-}"
  local volume="${BUDGET_VOLUME:-}"
  local network="${BUDGET_NETWORK:-}"
  local port_range="${BUDGET_PORT_RANGE:-}"
  local expected_system_id="${BUDGET_EXPECTED_SYSTEM_ID:-}"
  local trusted_parent="${BUDGET_TRUSTED_PARENT:-}"
  local expected_project expected_port marker_contents canonical_root

  case "${environment}" in
    development|uat|live) ;;
    *)
      budget_error 'environment must be exactly development, uat, or live' 64
      return
      ;;
  esac

  for value in "${root}" "${marker}" "${project}" "${hostname}" "${volume}" \
    "${network}" "${port_range}" "${expected_system_id}" "${trusted_parent}"; do
    if budget_is_protected_identifier "${value}"; then
      budget_error 'protected Sandooq/POS identifier refused' 65
      return
    fi
  done

  expected_project="$(budget_expected_project "${environment}")"
  expected_port="$(budget_expected_port_range "${environment}")"
  local identity_stem
  case "${environment}" in
    development) identity_stem='budget-supabase' ;;
    uat) identity_stem='budget-uat' ;;
    live) identity_stem='budget-live' ;;
  esac
  if [[ "${project}" != "${expected_project}" || "${port_range}" != "${expected_port}" || \
    ( "${hostname}" != "${identity_stem}."* && "${hostname}" != "${identity_stem}-"* ) || \
    "${volume}" != "${identity_stem}-"* || \
    "${network}" != "${identity_stem}-"* ]]; then
    budget_error 'target is outside the exact Budget allowlist' 65
    return
  fi

  canonical_root="$(budget_validate_safe_path "${root}" "${project}" "${trusted_parent}")"
  if [[ "${marker}" != "${root}/.budget-ops-marker" ]]; then
    budget_error 'unsafe Budget root' 66
    return
  fi
  if [[ ! "${expected_system_id}" =~ ^[0-9]{10,22}$ ]]; then
    budget_error 'database system identifier must be an exact numeric value' 68
    return
  fi

  if [[ ! -e "${marker}" && ! -L "${marker}" ]]; then
    budget_error 'environment marker is missing' 67
    return
  fi
  marker_contents="$(budget_read_private_marker "${marker}" 67 'environment marker is unsafe')"
  if [[ "${marker_contents}" != "budget-ops-marker-v1
environment=${environment}
project=${project}
system_id=${expected_system_id}" ]]; then
    budget_error 'environment marker identity mismatch' 67
    return
  fi
  readonly BUDGET_VALIDATED_ENV="${environment}"
  readonly BUDGET_VALIDATED_ROOT="${canonical_root}"
  readonly BUDGET_VALIDATED_TRUSTED_PARENT="${trusted_parent}"
  readonly BUDGET_VALIDATED_PROJECT="${project}"
  readonly BUDGET_VALIDATED_SYSTEM_ID="${expected_system_id}"
  printf '%s\n' "validated Budget ${environment} target"
}

budget_revalidate_environment() {
  local marker_contents
  budget_validate_safe_path "${BUDGET_VALIDATED_ROOT}" "${BUDGET_VALIDATED_PROJECT}" \
    "${BUDGET_VALIDATED_TRUSTED_PARENT}" >/dev/null
  marker_contents="$(budget_read_private_marker "${BUDGET_MARKER_PATH}" 67 \
    'environment marker is unsafe')" || {
      if [[ $? -eq 2 ]]; then budget_error 'environment marker is missing' 67; fi
      return 67
    }
  if [[ "${marker_contents}" != "budget-ops-marker-v1
environment=${BUDGET_VALIDATED_ENV}
project=${BUDGET_VALIDATED_PROJECT}
system_id=${BUDGET_VALIDATED_SYSTEM_ID}" ]]; then
    budget_error 'environment marker identity mismatch' 67
  fi
}

budget_assert_database_receipt() {
  local receipt="${1:-}"
  local expected_system_id="${2:-}"
  local expected_major="${3:-}"
  local expected_database="${4:-}"
  local expected_oid="${5:-}"
  local require_empty="${6:-0}"
  local status="${7:-68}"
  local mismatch_message="${8:-measured database identity mismatch}"
  local system_id major database oid relation_count extra

  IFS='|' read -r system_id major database oid relation_count extra <<< "${receipt}"
  if [[ ! "${system_id}" =~ ^[0-9]{10,22}$ || \
    ! "${major}" =~ ^[0-9]{1,3}$ || \
    ! "${database}" =~ ^[a-z][a-z0-9_]{0,62}$ || \
    ! "${oid}" =~ ^[0-9]{1,20}$ || \
    ! "${relation_count}" =~ ^[0-9]{1,20}$ || -n "${extra}" ]]; then
    budget_error 'database verifier returned an invalid bounded receipt' "${status}"
    return
  fi
  if [[ "${system_id}" != "${expected_system_id}" || \
    "${major}" != "${expected_major}" || \
    "${database}" != "${expected_database}" || "${oid}" != "${expected_oid}" ]]; then
    budget_error "${mismatch_message}" "${status}"
    return
  fi
  if [[ "${require_empty}" == '1' && "${relation_count}" != '0' ]]; then
    budget_error 'measured scratch database is not empty' "${status}"
    return
  fi
  printf '%s\n' "${receipt}"
}

budget_read_bounded_regular_file() {
  local candidate="${1:-}"
  local maximum_bytes="${2:-}"
  local status="${3:-64}"
  if [[ -z "${candidate}" || ! "${maximum_bytes}" =~ ^[1-9][0-9]{0,8}$ ]] || \
    ! /usr/bin/perl -MFcntl=:DEFAULT,O_NOFOLLOW,:mode -e '
      use strict;
      use warnings;
      my ($path, $limit) = @ARGV;
      alarm 5;
      my @before = lstat($path);
      die "type\n" unless @before && S_ISREG($before[2]) && $before[7] <= $limit;
      sysopen(my $handle, $path, O_RDONLY | O_NOFOLLOW) or die "open\n";
      my @opened = stat($handle);
      die "swap\n" unless @opened && S_ISREG($opened[2]);
      die "swap\n" unless $opened[0] == $before[0] && $opened[1] == $before[1];
      my $content = "";
      my $eof = 0;
      my $max_chunks = int($limit / 65_536) + 2;
      for (my $chunk = 0; $chunk < $max_chunks; $chunk++) {
        my $buffer;
        my $count = sysread($handle, $buffer, 65_536);
        die "read\n" unless defined $count;
        if ($count == 0) { $eof = 1; last; }
        $content .= substr($buffer, 0, $count);
        die "size\n" if length($content) > $limit;
      }
      die "bound\n" unless $eof;
      my @after = stat($handle);
      die "swap\n" unless @after && $after[0] == $opened[0] && $after[1] == $opened[1];
      die "binary\n" if index($content, "\0") >= 0;
      print $content;
    ' "${candidate}" "${maximum_bytes}"; then
    budget_error 'secret scan candidate is not a bounded regular file' "${status}"
    return
  fi
}

budget_scan_secrets() {
  if (( $# == 0 || $# > BUDGET_MAX_SCAN_FILES )); then
    budget_error 'secret scan requires 1 to 256 explicit files' 64
    return
  fi

  local candidate content line secret display_name read_status
  for candidate in "$@"; do
    if content="$(budget_read_bounded_regular_file \
      "${candidate}" "${BUDGET_MAX_SCAN_BYTES}" 64)"; then
      :
    else
      read_status=$?
      return "${read_status}"
    fi
    display_name="${candidate##*/}"

    while IFS= read -r secret; do
      if [[ -n "${secret}" && "${content}" == *"${secret}"* ]]; then
        budget_error "secret material detected in ${display_name}" 69
        return
      fi
    done <<< "${BUDGET_DISCOVERED_SECRETS:-}"

    local assigned_value assignment_key approved_placeholder
    while IFS= read -r line; do
      if [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?(SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|DB_PASSWORD|SMTP_(PASSWORD|TOKEN)|AGE_IDENTITY|ADMIN_TOKEN)[[:space:]]*= ]]; then
        assignment_key="${BASH_REMATCH[2]}"
        assigned_value="${line#*=}"
        printf -v approved_placeholder '${%s:?required}' "${assignment_key}"
        if [[ ! "${assigned_value}" =~ ^[[:space:]]*$ && \
          "${assigned_value}" != "${approved_placeholder}" && \
          "${assigned_value}" != '<external-secret-reference>' ]]; then
          budget_error "secret material detected in ${display_name}" 69
          return
        fi
      fi
    done <<< "${content}"
  done

  printf '%s\n' "secret scan passed for $# file(s)"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    validate-environment) budget_validate_environment ;;
    scan-secrets)
      shift
      budget_scan_secrets "$@"
      ;;
    *)
      budget_error 'usage: budget-common.sh {validate-environment|scan-secrets}' 64
      ;;
  esac
fi
