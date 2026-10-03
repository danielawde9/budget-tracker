-- Baseline part 1 of 9: types. Final schema exported from the original 61 migrations; apply in filename order to an empty database only.
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
-- Name: private; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA private;


ALTER SCHEMA private OWNER TO postgres;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--



ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: category_kind; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.category_kind AS ENUM (
    'income',
    'expense'
);


ALTER TYPE public.category_kind OWNER TO postgres;

--
-- Name: currency_code; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.currency_code AS ENUM (
    'USD',
    'LBP'
);


ALTER TYPE public.currency_code OWNER TO postgres;

--
-- Name: financial_event_kind; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.financial_event_kind AS ENUM (
    'opening_balance',
    'income',
    'expense',
    'transfer',
    'reversal',
    'loan_opening',
    'loan_lend',
    'loan_borrow',
    'loan_receive_repayment',
    'loan_repay_borrowing',
    'exchange'
);


ALTER TYPE public.financial_event_kind OWNER TO postgres;

--
-- Name: household_invitation_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.household_invitation_status AS ENUM (
    'pending',
    'accepted',
    'cancelled'
);


ALTER TYPE public.household_invitation_status OWNER TO postgres;

--
-- Name: household_membership_event_kind; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.household_membership_event_kind AS ENUM (
    'invitation_created',
    'invitation_cancelled',
    'invitation_accepted',
    'member_removed',
    'member_left',
    'member_promoted',
    'member_demoted'
);


ALTER TYPE public.household_membership_event_kind OWNER TO postgres;

--
-- Name: loan_direction; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.loan_direction AS ENUM (
    'they_owe_me',
    'i_owe_them'
);


ALTER TYPE public.loan_direction OWNER TO postgres;

--
-- Name: member_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.member_role AS ENUM (
    'owner',
    'member'
);


ALTER TYPE public.member_role OWNER TO postgres;

--
-- Name: membership_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.membership_status AS ENUM (
    'active',
    'revoked',
    'left'
);


ALTER TYPE public.membership_status OWNER TO postgres;

--
-- Name: space_kind; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.space_kind AS ENUM (
    'personal',
    'household'
);


ALTER TYPE public.space_kind OWNER TO postgres;

--
-- PostgreSQL database dump complete
--



-- Put the session settings the export changed back, so later migrations on this connection are unaffected.
select pg_catalog.set_config('search_path', '"$user", public, extensions', false);
reset statement_timeout; reset lock_timeout; reset idle_in_transaction_session_timeout; reset transaction_timeout;
reset check_function_bodies; reset row_security; reset client_min_messages; reset xmloption;
