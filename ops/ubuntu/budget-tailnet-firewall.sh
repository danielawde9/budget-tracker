#!/usr/bin/env bash
set -euo pipefail

readonly budget_ports='54420:54429'
readonly tailscale_ipv4='100.64.0.0/10'
readonly tailscale_ipv6='fd7a:115c:a1e0::/48'

ensure_rule() {
  local command_name="$1"
  local position="$2"
  shift 2

  if ! "${command_name}" -C DOCKER-USER "$@" 2>/dev/null; then
    "${command_name}" -I DOCKER-USER "${position}" "$@"
  fi
}

ensure_family_rules() {
  local command_name="$1"
  local tailscale_range="$2"

  ensure_rule "${command_name}" 1 \
    -s "${tailscale_range}" \
    -p tcp \
    -m conntrack --ctorigdstport "${budget_ports}" \
    -j ACCEPT

  ensure_rule "${command_name}" 2 \
    ! -i tailscale0 \
    -p tcp \
    -m conntrack --ctstate NEW --ctorigdstport "${budget_ports}" \
    -j DROP
}

ensure_family_rules iptables "${tailscale_ipv4}"
ensure_family_rules ip6tables "${tailscale_ipv6}"
