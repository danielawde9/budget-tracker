#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly CHECK_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly CHECK_REPO_ROOT="$(cd "${CHECK_SCRIPT_DIR}/../.." && pwd -P)"
# shellcheck source=./budget-common.sh
source "${CHECK_SCRIPT_DIR}/budget-common.sh"

readonly -a CHECK_OPS_SCRIPTS=(
  "${CHECK_SCRIPT_DIR}/budget-common.sh"
  "${CHECK_SCRIPT_DIR}/backup-budget.sh"
  "${CHECK_SCRIPT_DIR}/restore-budget.sh"
  "${CHECK_SCRIPT_DIR}/migrate-budget.sh"
  "${CHECK_SCRIPT_DIR}/check-budget.sh"
)

bash -n "${CHECK_OPS_SCRIPTS[@]}"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "${CHECK_OPS_SCRIPTS[@]}"
else
  printf '%s\n' 'shellcheck unavailable; bash syntax check completed'
fi

if [[ "${BUDGET_OPS_STATIC_ONLY:-0}" != '1' ]]; then
  (cd "${CHECK_REPO_ROOT}" && pnpm exec vitest run tests/ops --pool=forks --no-file-parallelism)
fi

tracked_files=()
while IFS= read -r tracked_file; do
  case "${tracked_file}" in
    *.ts|*.tsx|*.js|*.jsx|*.sh|*.md|*.json|*.yaml|*.yml|*.toml|*.sql|*.service|*.example|.nvmrc)
      tracked_files+=("${CHECK_REPO_ROOT}/${tracked_file}")
      ;;
  esac
  if (( ${#tracked_files[@]} > BUDGET_MAX_SCAN_FILES )); then
    budget_error 'tracked text-file secret scan exceeds 256 files' 69
    exit 69
  fi
done < <(cd "${CHECK_REPO_ROOT}" && git ls-files)

if (( ${#tracked_files[@]} == 0 )); then
  budget_error 'tracked text-file secret scan found no candidates' 69
  exit 69
fi
budget_scan_secrets "${tracked_files[@]}"

if (cd "${CHECK_REPO_ROOT}" && git grep -IlE \
  'VITE_[A-Z0-9_]*(SERVICE_ROLE|JWT|PASSWORD|SMTP|AGE|ADMIN)[A-Z0-9_]*[[:space:]]*=' \
  -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.sh' '*.json' '*.example') | grep -q .; then
  budget_error 'server-secret-shaped VITE assignment detected in tracked source' 69
  exit 69
fi

printf '%s\n' 'Budget ops verification passed'
