#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_RELEASE_START='d4bf9d2c39063eb52782188a2f860d3099994361'

if (( $# > 1 )); then
  printf 'usage: %s [release-start-sha]\n' "$0" >&2
  exit 64
fi

readonly release_start="${1:-$DEFAULT_RELEASE_START}"
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly repo_root="$(cd "$script_dir/.." && pwd -P)"

git -C "$repo_root" cat-file -e "${release_start}^{commit}" 2>/dev/null || {
  printf 'private UAT scope check: unknown release start %s\n' "$release_start" >&2
  exit 2
}

git -C "$repo_root" merge-base --is-ancestor "$release_start" HEAD || {
  printf 'private UAT scope check: HEAD does not descend from %s\n' "$release_start" >&2
  exit 3
}

readonly -a protected_paths=(
  'supabase/'
  'tests/db/'
  'src/features/auth/'
  ':(glob)src/features/**/supabase-*-gateway.ts'
  'src/features/household/'
  'src/features/households/'
  'src/features/monthly-budget/'
  'src/features/monthly_budget/'
  'src/features/budget/'
  'src/features/reporting/'
  'src/features/reports/'
)

changed_paths="$({
  git -C "$repo_root" diff --name-only "$release_start" -- "${protected_paths[@]}"
  git -C "$repo_root" ls-files --others --exclude-standard -- "${protected_paths[@]}"
} | LC_ALL=C sort -u)"

if [[ -n "$changed_paths" ]]; then
  printf 'private UAT scope check: protected paths changed since %s:\n%s\n' "$release_start" "$changed_paths" >&2
  exit 1
fi

printf 'private UAT scope check passed from %s to %s\n' "$release_start" "$(git -C "$repo_root" rev-parse HEAD)"
