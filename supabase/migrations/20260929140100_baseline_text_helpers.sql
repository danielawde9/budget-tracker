-- Baseline part 3 of 9: text_helpers. Final schema exported from the original 61 migrations; apply in filename order to an empty database only.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: arabic_category_key(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.arabic_category_key(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
  select coalesce(
    private.canonical_category_name(
      pg_catalog.regexp_replace(
        pg_catalog.translate(
          private.canonical_category_name(p_value),
          'آأإىة',
          'ااايه'
        ),
        '[ؐ-ؚـً-ٰٟۖ-ۭ]',
        '',
        'g'
      )
    ),
    ''
  );
$$;


ALTER FUNCTION private.arabic_category_key(p_value text) OWNER TO postgres;

--
-- Name: canonical_category_name(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.canonical_category_name(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
  select nullif(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.normalize(p_value, 'NFKC'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;


ALTER FUNCTION private.canonical_category_name(p_value text) OWNER TO postgres;

--
-- Name: canonical_payee_name(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.canonical_payee_name(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
  select private.canonical_category_name(p_value);
$$;


ALTER FUNCTION private.canonical_payee_name(p_value text) OWNER TO postgres;

--
-- Name: english_category_key(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.english_category_key(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
  select pg_catalog.lower(private.canonical_category_name(p_value));
$$;


ALTER FUNCTION private.english_category_key(p_value text) OWNER TO postgres;

--
-- Name: payee_name_key(text); Type: FUNCTION; Schema: private; Owner: postgres
--

CREATE FUNCTION private.payee_name_key(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
  select pg_catalog.lower(private.arabic_category_key(private.canonical_payee_name(p_value)));
$$;


ALTER FUNCTION private.payee_name_key(p_value text) OWNER TO postgres;

--
-- PostgreSQL database dump complete
--



-- Put the session settings the export changed back, so later migrations on this connection are unaffected.
select pg_catalog.set_config('search_path', '"$user", public, extensions', false);
reset statement_timeout; reset lock_timeout; reset idle_in_transaction_session_timeout; reset transaction_timeout;
reset check_function_bodies; reset row_security; reset client_min_messages; reset xmloption;
