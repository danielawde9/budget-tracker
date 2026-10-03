-- Test-only stand-in for the two Supabase Auth objects the budget schema uses.
-- The Supabase image creates them only in its `postgres` database, which cannot
-- be cloned because pg_net and pg_cron keep sessions open there. The local
-- Supabase stack used by the preview and e2e tests runs the real Auth schema.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
