#!/bin/bash
set -euo pipefail
umask 077
export PATH='/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin'

readonly role_toc="${1:-}"
readonly role_sql="${2:-}"
readonly role_manifest="${3:-}"

if [[ $# -ne 3 || "${role_toc}" != /* || "${role_sql}" != /* || \
  "${role_manifest}" != /* || ! -f "${role_toc}" || ! -f "${role_sql}" || \
  ! -f "${role_manifest}" ]]; then
  printf '%s\n' 'budget ops: restore role validator inputs are invalid' >&2
  exit 79
fi

/usr/bin/perl -e '
  use strict;
  use warnings;
  alarm 10;
  my ($toc_path, $sql_path, $manifest_path) = @ARGV;
  my %allowed;
  open my $manifest, "<", $manifest_path or die "inputs\n";
  my $manifest_lines = 0;
  while (my $line = <$manifest>) {
    chomp $line;
    next if $line eq "";
    ++$manifest_lines;
    die "manifest\n" if $manifest_lines > 64;
    die "manifest\n" unless $line =~ /^[a-z_][a-z0-9_]{0,62}$/;
    die "manifest\n" if $allowed{$line}++;
  }
  unless ($allowed{authenticated} && $allowed{service_role}) {
    print STDERR "budget ops: required target roles are missing\n";
    exit 79;
  }

  die "toc\n" if -s $toc_path > 2_097_152;
  open my $toc, "<", $toc_path or die "inputs\n";
  my $toc_lines = 0;
  my $toc_entries = 0;
  while (my $line = <$toc>) {
    ++$toc_lines;
    die "toc\n" if $toc_lines > 10_000;
    next if $line =~ /^;/ || $line =~ /^\s*$/;
    ++$toc_entries;
    chomp $line;
    unless ($line =~ /^[0-9]+; [0-9]+ [0-9]+ .+ ([a-z_][a-z0-9_]{0,62}|-)$/) {
      print STDERR "budget ops: archive TOC is invalid\n";
      exit 79;
    }
    my $owner = $1;
    unless ($owner eq "-" || $allowed{$owner}) {
      print STDERR "budget ops: archive owner or SQL grantee is not allowlisted\n";
      exit 79;
    }
  }
  unless ($toc_entries > 0) {
    print STDERR "budget ops: archive TOC is invalid\n";
    exit 79;
  }

  die "sql\n" if -s $sql_path > 1_048_576;
  open my $sql_handle, "<", $sql_path or die "inputs\n";
  local $/;
  my $sql = <$sql_handle>;
  $sql = "" unless defined $sql;
  if ($sql =~ /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ || $sql =~ /"/) {
    print STDERR "budget ops: filtered role SQL is invalid\n";
    exit 79;
  }
  while ($sql =~ /\b(?:CREATE\s+ROLE|OWNER\s+TO)\s+([a-z_][a-z0-9_]{0,62})/ig) {
    unless ($allowed{$1}) {
      print STDERR "budget ops: archive owner or SQL grantee is not allowlisted\n";
      exit 79;
    }
  }
  while ($sql =~ /\b(?:GRANT|REVOKE)\b[^;]*?\b(?:TO|FROM)\s+([^;]+);/igs) {
    my $targets = $1;
    $targets =~ s/\s+WITH\s+GRANT\s+OPTION\s*$//i;
    for my $target (split /\s*,\s*/, $targets) {
      $target =~ s/^\s+|\s+$//g;
      unless ($target =~ /^[a-z_][a-z0-9_]{0,62}$/ && $allowed{$target}) {
        print STDERR "budget ops: archive owner or SQL grantee is not allowlisted\n";
        exit 79;
      }
    }
  }
  print "restore role boundary verified\n";
' "${role_toc}" "${role_sql}" "${role_manifest}" || {
  status=$?
  if [[ "${status}" -eq 79 ]]; then exit 79; fi
  printf '%s\n' 'budget ops: restore role validator failed closed' >&2
  exit 79
}
