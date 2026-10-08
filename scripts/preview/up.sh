#!/usr/bin/env bash
# Starts the LOCAL preview: a private Supabase stack in Docker on this machine
# (separate from production and from the shared dev database), resets it to
# the v2 migrations, seeds the demo accounts, and writes .env.demo.local for
# `pnpm demo`. Nothing here talks to a hosted project.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and run this again." >&2
  exit 1
fi

supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,studio,postgres-meta,mailpit
supabase db reset --local

status="$(supabase status -o env)"
value() { printf '%s\n' "${status}" | sed -n "s/^$1=\"\(.*\)\"$/\1/p" | head -n 1; }
api_url="$(value API_URL)"
anon_key="$(value ANON_KEY)"
service_key="$(value SERVICE_ROLE_KEY)"
db_url="$(value DB_URL)"
case "${api_url}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing: the API URL is not local (${api_url})." >&2; exit 1 ;;
esac
case "${db_url}" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo "Refusing: the database URL is not local." >&2; exit 1 ;;
esac

umask 077
cat > .env.demo.local <<ENV
# Written by scripts/preview/up.sh — LOCAL preview only (gitignored).
VITE_SUPABASE_URL=${api_url}
VITE_SUPABASE_ANON_KEY=${anon_key}
VITE_DEMO=1
DEMO_DATABASE_URL=${db_url}
ENV

SUPABASE_URL="${api_url}" SUPABASE_ANON_KEY="${anon_key}" SUPABASE_SERVICE_ROLE_KEY="${service_key}" node scripts/preview/seed.ts
echo "Preview ready. Run: pnpm demo   then open http://127.0.0.1:5173"
