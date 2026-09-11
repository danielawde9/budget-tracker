-- Synthetic Supabase-shaped source database for the scratch-restore tests.
-- It stands in for Budget Production: every role, table, and row is invented,
-- and nothing here is copied from a real dump. Run as supabase_admin on
-- supabase/postgres:17.6.1.166, whose default privileges match production.

-- Realtime provisions this role on hosted projects; the bare image lacks it,
-- and the CLI role dump still grants it a parameter (restore defect 1).
CREATE ROLE supabase_realtime_admin
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
GRANT anon, authenticated, service_role TO supabase_realtime_admin;
GRANT SET ON PARAMETER log_min_messages TO supabase_realtime_admin;

-- Replace the image placeholder Auth schema with a GoTrue-shaped one.
DROP TABLE auth.audit_log_entries, auth.instances, auth.refresh_tokens,
  auth.schema_migrations, auth.users;
DROP FUNCTION auth.email(), auth.role(), auth.uid();

SET ROLE supabase_auth_admin;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  encrypted_password text,
  created_at timestamptz NOT NULL
);
CREATE TABLE auth.identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider text NOT NULL
);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE TABLE auth.refresh_tokens (
  id bigserial PRIMARY KEY,
  token text NOT NULL,
  session_id uuid REFERENCES auth.sessions (id) ON DELETE CASCADE
);
CREATE TABLE auth.mfa_amr_claims (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES auth.sessions (id) ON DELETE CASCADE
);
CREATE TABLE auth.one_time_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE TABLE auth.flow_state (id uuid PRIMARY KEY);
CREATE TABLE auth.schema_migrations (version varchar(255) PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
RESET ROLE;

-- Storage tables exist on hosted projects but stay empty for Budget.
SET ROLE supabase_storage_admin;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY,
  bucket_id text REFERENCES storage.buckets (id)
);
GRANT ALL ON storage.buckets, storage.objects TO postgres;
RESET ROLE;

-- Migration history and the application schema are created by postgres, so
-- the image's public default privileges widen every new object exactly as
-- they do on a hosted project; the grants below narrow them again.
SET ROLE postgres;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);

CREATE SCHEMA private;
-- Turns the schema ACL from NULL into its explicit default value.
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TYPE public.space_kind AS ENUM ('personal', 'household');
CREATE TABLE public.spaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  kind public.space_kind NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE public.space_members (
  space_id uuid NOT NULL REFERENCES public.spaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id),
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE public.categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES public.spaces (id),
  name_en text,
  name_ar text,
  CONSTRAINT categories_named CHECK (num_nonnulls(name_en, name_ar) > 0)
);
CREATE INDEX categories_space_idx ON public.categories (space_id);
CREATE SEQUENCE public.journal_number_seq;
CREATE TABLE private.household_invitation_keys (
  id smallint PRIMARY KEY,
  key_hash text NOT NULL
);

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY spaces_member_read ON public.spaces
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.space_members AS member
    WHERE member.space_id = spaces.id AND member.user_id = auth.uid()
  ));
CREATE POLICY space_members_self_read ON public.space_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY categories_member_read ON public.categories
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.space_members AS member
    WHERE member.space_id = categories.space_id AND member.user_id = auth.uid()
  ));

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER spaces_touch_updated_at BEFORE UPDATE ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE FUNCTION public.leave_household_space(p_space_id uuid, p_request_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
BEGIN
  DELETE FROM public.space_members
  WHERE space_id = p_space_id AND user_id = auth.uid();
END
$$;

REVOKE ALL ON public.spaces, public.space_members, public.categories
  FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.journal_number_seq, public.categories_id_seq
  FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.touch_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.leave_household_space(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.spaces, public.space_members, public.categories TO authenticated;
GRANT ALL ON public.spaces, public.space_members, public.categories TO service_role;
GRANT EXECUTE ON FUNCTION public.leave_household_space(uuid, uuid) TO authenticated;
RESET ROLE;

-- Synthetic rows, including an apostrophe and Arabic text.
INSERT INTO auth.users (id, email, encrypted_password, created_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner@budget.invalid',
    'synthetic-not-a-password-hash', '2026-09-01 08:00:00+00'),
  ('00000000-0000-4000-8000-000000000002', 'member@budget.invalid',
    NULL, '2026-09-02 08:00:00+00');
INSERT INTO auth.identities (id, user_id, provider) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'email');
INSERT INTO auth.sessions (id, user_id) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');
INSERT INTO auth.refresh_tokens (token, session_id) VALUES
  ('synthetic-refresh-token', '20000000-0000-4000-8000-000000000001');
INSERT INTO auth.mfa_amr_claims (id, session_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
INSERT INTO auth.one_time_tokens (id, user_id) VALUES
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');
INSERT INTO auth.flow_state (id) VALUES ('50000000-0000-4000-8000-000000000001');
INSERT INTO auth.schema_migrations (version) VALUES ('00'), ('20240729123726');

INSERT INTO public.spaces (id, name, kind, owner_id, created_at, updated_at) VALUES
  ('60000000-0000-4000-8000-000000000001', 'Home budget', 'household',
    '00000000-0000-4000-8000-000000000001', '2026-09-03 09:00:00+00', '2026-09-03 09:00:00+00');
INSERT INTO public.space_members (space_id, user_id) VALUES
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
INSERT INTO public.categories (space_id, name_en, name_ar) VALUES
  ('60000000-0000-4000-8000-000000000001', 'Groceries', 'بقالة'),
  ('60000000-0000-4000-8000-000000000001', NULL, 'دخل اضافي'),
  ('60000000-0000-4000-8000-000000000001', 'O''Brien''s rent', NULL);
SELECT setval('public.journal_number_seq', 42);
INSERT INTO private.household_invitation_keys (id, key_hash) VALUES (1, 'synthetic-key-hash');
INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES
  ('20260907100000', ARRAY['create table public.spaces ();'], 'spaces');
