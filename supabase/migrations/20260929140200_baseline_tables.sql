-- Baseline part 4 of 9: tables. Final schema exported from the original 61 migrations; apply in filename order to an empty database only.
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
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--



SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: wallets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    name text NOT NULL,
    currency public.currency_code NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT wallets_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120)))
);


ALTER TABLE public.wallets OWNER TO postgres;

--
-- Name: household_invitation_keys; Type: TABLE; Schema: private; Owner: postgres
--

CREATE TABLE private.household_invitation_keys (
    key_version smallint NOT NULL,
    identity_hmac_key bytea NOT NULL,
    token_hmac_key bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT household_invitation_key_lengths_check CHECK (((octet_length(identity_hmac_key) = 32) AND (octet_length(token_hmac_key) = 32))),
    CONSTRAINT household_invitation_key_retirement_check CHECK (((retired_at IS NULL) OR (retired_at > created_at))),
    CONSTRAINT household_invitation_keys_key_version_check CHECK ((key_version > 0))
);


ALTER TABLE private.household_invitation_keys OWNER TO postgres;

--
-- Name: allocation_groups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_groups (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    purpose text NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT allocation_groups_id_check CHECK ((id <> 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)),
    CONSTRAINT allocation_groups_purpose_check CHECK ((purpose = ANY (ARRAY['spending'::text, 'future'::text])))
);


ALTER TABLE public.allocation_groups OWNER TO postgres;

--
-- Name: allocation_month_commitments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_month_commitments (
    snapshot_id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    group_id uuid,
    source_kind text NOT NULL,
    observed_actual_minor bigint NOT NULL,
    observed_remaining_minor bigint NOT NULL,
    CONSTRAINT allocation_month_commitments_observed_remaining_minor_check CHECK ((observed_remaining_minor >= 0)),
    CONSTRAINT allocation_month_commitments_source_kind_check CHECK ((source_kind = 'loan_pool'::text))
);


ALTER TABLE public.allocation_month_commitments OWNER TO postgres;

--
-- Name: allocation_month_goal_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_month_goal_lines (
    snapshot_id bigint NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    month_start date NOT NULL,
    group_id uuid,
    target_revision_id bigint NOT NULL,
    amount_minor bigint NOT NULL,
    CONSTRAINT allocation_month_goal_lines_amount_minor_check CHECK (((amount_minor >= 0) AND (amount_minor <= '999999999999999'::bigint)))
);


ALTER TABLE public.allocation_month_goal_lines OWNER TO postgres;

--
-- Name: allocation_month_groups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_month_groups (
    snapshot_id bigint NOT NULL,
    group_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    name_en text,
    name_ar text,
    purpose text NOT NULL,
    display_order integer NOT NULL,
    basis_points integer NOT NULL,
    target_minor bigint NOT NULL,
    CONSTRAINT allocation_month_groups_basis_points_check CHECK (((basis_points >= 0) AND (basis_points <= 10000))),
    CONSTRAINT allocation_month_groups_check CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT allocation_month_groups_display_order_check CHECK (((display_order >= 0) AND (display_order <= 11))),
    CONSTRAINT allocation_month_groups_name_ar_check CHECK ((((name_ar IS NULL) OR ((char_length(btrim(name_ar)) >= 1) AND (char_length(btrim(name_ar)) <= 80))) IS TRUE)),
    CONSTRAINT allocation_month_groups_name_en_check CHECK ((((name_en IS NULL) OR ((char_length(btrim(name_en)) >= 1) AND (char_length(btrim(name_en)) <= 80))) IS TRUE)),
    CONSTRAINT allocation_month_groups_purpose_check CHECK ((purpose = ANY (ARRAY['spending'::text, 'future'::text]))),
    CONSTRAINT allocation_month_groups_target_minor_check CHECK (((target_minor >= 0) AND (target_minor <= '999999999999999'::bigint)))
);


ALTER TABLE public.allocation_month_groups OWNER TO postgres;

--
-- Name: allocation_month_roots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_month_roots (
    snapshot_id bigint NOT NULL,
    category_id uuid NOT NULL,
    category_kind public.category_kind DEFAULT 'expense'::public.category_kind NOT NULL,
    group_id uuid,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    target_revision_id bigint NOT NULL,
    target_minor bigint NOT NULL,
    CONSTRAINT allocation_month_roots_category_kind_check CHECK ((category_kind = 'expense'::public.category_kind)),
    CONSTRAINT allocation_month_roots_target_minor_check CHECK (((target_minor >= 0) AND (target_minor <= '999999999999999'::bigint)))
);


ALTER TABLE public.allocation_month_roots OWNER TO postgres;

--
-- Name: allocation_month_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_month_snapshots (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    month_start date NOT NULL,
    template_revision_id bigint NOT NULL,
    income_plan_revision_id bigint NOT NULL,
    expected_snapshot_id bigint,
    base_income_minor bigint NOT NULL,
    unallocated_minor bigint NOT NULL,
    group_count integer NOT NULL,
    root_count integer NOT NULL,
    loan_line_count integer NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    goal_line_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT allocation_month_snapshots_base_income_minor_check CHECK (((base_income_minor >= 0) AND (base_income_minor <= '999999999999999'::bigint))),
    CONSTRAINT allocation_month_snapshots_goal_line_count_check CHECK (((goal_line_count >= 0) AND (goal_line_count <= 100))),
    CONSTRAINT allocation_month_snapshots_group_count_check CHECK (((group_count >= 0) AND (group_count <= 12))),
    CONSTRAINT allocation_month_snapshots_loan_line_count_check CHECK (((loan_line_count >= 0) AND (loan_line_count <= 1))),
    CONSTRAINT allocation_month_snapshots_month_start_check CHECK ((month_start = (date_trunc('month'::text, (month_start)::timestamp with time zone))::date)),
    CONSTRAINT allocation_month_snapshots_root_count_check CHECK (((root_count >= 0) AND (root_count <= 200))),
    CONSTRAINT allocation_month_snapshots_unallocated_minor_check CHECK (((unallocated_minor >= 0) AND (unallocated_minor <= '999999999999999'::bigint)))
);


ALTER TABLE public.allocation_month_snapshots OWNER TO postgres;

--
-- Name: allocation_month_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_month_snapshots ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.allocation_month_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: allocation_template_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_template_lines (
    template_id bigint NOT NULL,
    group_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    name_en text,
    name_ar text,
    display_order integer NOT NULL,
    basis_points integer NOT NULL,
    CONSTRAINT allocation_template_lines_basis_points_check CHECK (((basis_points >= 0) AND (basis_points <= 10000))),
    CONSTRAINT allocation_template_lines_check CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT allocation_template_lines_display_order_check CHECK (((display_order >= 0) AND (display_order <= 11))),
    CONSTRAINT allocation_template_lines_name_ar_check CHECK ((((name_ar IS NULL) OR ((char_length(btrim(name_ar)) >= 1) AND (char_length(btrim(name_ar)) <= 80))) IS TRUE)),
    CONSTRAINT allocation_template_lines_name_en_check CHECK ((((name_en IS NULL) OR ((char_length(btrim(name_en)) >= 1) AND (char_length(btrim(name_en)) <= 80))) IS TRUE))
);


ALTER TABLE public.allocation_template_lines OWNER TO postgres;

--
-- Name: allocation_template_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_template_revisions (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    expected_revision_id bigint,
    group_count integer NOT NULL,
    root_count integer NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT allocation_template_revisions_group_count_check CHECK (((group_count >= 0) AND (group_count <= 12))),
    CONSTRAINT allocation_template_revisions_root_count_check CHECK (((root_count >= 0) AND (root_count <= 200)))
);


ALTER TABLE public.allocation_template_revisions OWNER TO postgres;

--
-- Name: allocation_template_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_template_revisions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.allocation_template_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: allocation_template_roots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_template_roots (
    template_id bigint NOT NULL,
    category_id uuid NOT NULL,
    category_kind public.category_kind DEFAULT 'expense'::public.category_kind NOT NULL,
    group_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    CONSTRAINT allocation_template_roots_category_kind_check CHECK ((category_kind = 'expense'::public.category_kind))
);


ALTER TABLE public.allocation_template_roots OWNER TO postgres;

--
-- Name: budget_month_carry_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.budget_month_carry_links (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    source_close_id bigint NOT NULL,
    source_month_start date NOT NULL,
    target_snapshot_id bigint NOT NULL,
    target_month_start date NOT NULL,
    root_id uuid NOT NULL,
    source_enabled boolean DEFAULT true NOT NULL,
    carry_minor numeric(30,0) NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT budget_month_carry_links_check CHECK ((target_month_start = ((source_month_start + '1 mon'::interval))::date)),
    CONSTRAINT budget_month_carry_links_source_enabled_check CHECK (source_enabled)
);


ALTER TABLE public.budget_month_carry_links OWNER TO postgres;

--
-- Name: budget_month_carry_links_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.budget_month_carry_links ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.budget_month_carry_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: budget_month_close_roots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.budget_month_close_roots (
    close_id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    month_start date NOT NULL,
    source_snapshot_id bigint NOT NULL,
    root_id uuid NOT NULL,
    root_kind public.category_kind DEFAULT 'expense'::public.category_kind NOT NULL,
    policy_revision_id bigint,
    enabled boolean NOT NULL,
    base_target_minor bigint NOT NULL,
    incoming_carry_minor numeric(30,0) NOT NULL,
    actual_minor numeric(30,0) NOT NULL,
    outgoing_carry_minor numeric(30,0) NOT NULL,
    CONSTRAINT budget_month_close_roots_base_target_minor_check CHECK (((base_target_minor >= 0) AND (base_target_minor <= '999999999999999'::bigint))),
    CONSTRAINT budget_month_close_roots_check CHECK ((((policy_revision_id IS NOT NULL) OR (NOT enabled)) IS TRUE)),
    CONSTRAINT budget_month_close_roots_check1 CHECK ((outgoing_carry_minor =
CASE
    WHEN enabled THEN (((base_target_minor)::numeric + incoming_carry_minor) - actual_minor)
    ELSE (0)::numeric
END)),
    CONSTRAINT budget_month_close_roots_root_kind_check CHECK ((root_kind = 'expense'::public.category_kind))
);


ALTER TABLE public.budget_month_close_roots OWNER TO postgres;

--
-- Name: budget_month_closes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.budget_month_closes (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    month_start date NOT NULL,
    source_snapshot_id bigint NOT NULL,
    expected_close_id bigint,
    fact_digest bytea NOT NULL,
    fact_count bigint NOT NULL,
    root_count integer NOT NULL,
    closed_income_minor numeric(30,0) NOT NULL,
    closed_spending_minor numeric(30,0) NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT budget_month_closes_check CHECK ((((expected_close_id IS NULL) OR (expected_close_id < id)) IS TRUE)),
    CONSTRAINT budget_month_closes_check1 CHECK (((month_start + '1 mon'::interval) <= (created_at AT TIME ZONE 'UTC'::text))),
    CONSTRAINT budget_month_closes_fact_count_check CHECK (((fact_count >= 0) AND (fact_count <= 100000))),
    CONSTRAINT budget_month_closes_fact_digest_check CHECK ((octet_length(fact_digest) = 32)),
    CONSTRAINT budget_month_closes_month_start_check CHECK ((month_start = (date_trunc('month'::text, (month_start)::timestamp with time zone))::date)),
    CONSTRAINT budget_month_closes_root_count_check CHECK (((root_count >= 0) AND (root_count <= 200)))
);


ALTER TABLE public.budget_month_closes OWNER TO postgres;

--
-- Name: budget_month_closes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.budget_month_closes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.budget_month_closes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    kind public.category_kind NOT NULL,
    name_en text,
    name_ar text,
    name_en_key text GENERATED ALWAYS AS (private.english_category_key(name_en)) STORED,
    name_ar_key text GENERATED ALWAYS AS (private.arabic_category_key(name_ar)) STORED,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_by uuid,
    archived_at timestamp with time zone,
    parent_category_id uuid,
    CONSTRAINT categories_archive_pair_check CHECK (((archived_by IS NULL) = (archived_at IS NULL))),
    CONSTRAINT categories_name_ar_canonical_check CHECK (((name_ar IS NULL) OR ((name_ar = private.canonical_category_name(name_ar)) AND ((char_length(name_ar) >= 1) AND (char_length(name_ar) <= 120))))),
    CONSTRAINT categories_name_ar_key_nonempty_check CHECK (((name_ar_key IS NULL) OR (btrim(name_ar_key) <> ''::text))),
    CONSTRAINT categories_name_ar_key_pair_check CHECK (((name_ar IS NULL) = (name_ar_key IS NULL))),
    CONSTRAINT categories_name_en_canonical_check CHECK (((name_en IS NULL) OR ((name_en = private.canonical_category_name(name_en)) AND ((char_length(name_en) >= 1) AND (char_length(name_en) <= 120))))),
    CONSTRAINT categories_name_en_key_nonempty_check CHECK (((name_en_key IS NULL) OR (btrim(name_en_key) <> ''::text))),
    CONSTRAINT categories_name_en_key_pair_check CHECK (((name_en IS NULL) = (name_en_key IS NULL))),
    CONSTRAINT categories_name_present_check CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT categories_parent_not_self_check CHECK (((parent_category_id IS NULL) OR (parent_category_id <> id)))
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: category_command_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.category_command_requests (
    space_id uuid NOT NULL,
    request_id uuid NOT NULL,
    command_kind text NOT NULL,
    request_fingerprint bytea NOT NULL,
    category_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT category_command_requests_command_kind_check CHECK ((command_kind = ANY (ARRAY['create_category'::text, 'create_subcategory'::text, 'archive_category'::text])))
);


ALTER TABLE public.category_command_requests OWNER TO postgres;

--
-- Name: financial_event_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.financial_event_categories (
    event_id uuid NOT NULL,
    space_id uuid NOT NULL,
    event_kind public.financial_event_kind NOT NULL,
    category_id uuid NOT NULL,
    category_kind public.category_kind NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT financial_event_categories_check CHECK ((((event_kind = 'income'::public.financial_event_kind) AND (category_kind = 'income'::public.category_kind)) OR ((event_kind = 'expense'::public.financial_event_kind) AND (category_kind = 'expense'::public.category_kind)) OR (event_kind = 'reversal'::public.financial_event_kind)))
);


ALTER TABLE public.financial_event_categories OWNER TO postgres;

--
-- Name: financial_event_description_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.financial_event_description_requests (
    space_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint bytea NOT NULL,
    event_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.financial_event_description_requests OWNER TO postgres;

--
-- Name: financial_event_descriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.financial_event_descriptions (
    event_id uuid NOT NULL,
    space_id uuid NOT NULL,
    payee_id uuid,
    note text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT financial_event_descriptions_content_check CHECK (((payee_id IS NOT NULL) OR (note IS NOT NULL))),
    CONSTRAINT financial_event_descriptions_note_check CHECK (((note IS NULL) OR ((note = NULLIF(btrim("normalize"(note, 'NFKC'::text)), ''::text)) AND ((char_length(note) >= 1) AND (char_length(note) <= 2000)))))
);


ALTER TABLE public.financial_event_descriptions OWNER TO postgres;

--
-- Name: financial_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.financial_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint bytea NOT NULL,
    kind public.financial_event_kind NOT NULL,
    effective_date date NOT NULL,
    actor_id uuid NOT NULL,
    reversal_of uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.financial_events OWNER TO postgres;

--
-- Name: goal_earmark_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_earmark_events (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    operation text NOT NULL,
    reversal_of bigint,
    line_count integer NOT NULL,
    effective_date date DEFAULT ((now() AT TIME ZONE 'UTC'::text))::date NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goal_earmark_events_check CHECK (((((operation = 'reverse'::text) AND (reversal_of IS NOT NULL)) OR ((operation <> 'reverse'::text) AND (reversal_of IS NULL))) IS TRUE)),
    CONSTRAINT goal_earmark_events_line_count_check CHECK (((line_count >= 1) AND (line_count <= 2))),
    CONSTRAINT goal_earmark_events_operation_check CHECK ((operation = ANY (ARRAY['reserve'::text, 'release'::text, 'move'::text, 'reverse'::text])))
);


ALTER TABLE public.goal_earmark_events OWNER TO postgres;

--
-- Name: goal_earmark_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_earmark_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.goal_earmark_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: goal_earmark_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_earmark_lines (
    event_id bigint NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    amount_minor bigint NOT NULL,
    CONSTRAINT goal_earmark_lines_amount_minor_check CHECK (((amount_minor <> 0) AND ((amount_minor >= '-999999999999999'::bigint) AND (amount_minor <= '999999999999999'::bigint))))
);


ALTER TABLE public.goal_earmark_lines OWNER TO postgres;

--
-- Name: goal_milestone_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_milestone_events (
    id bigint NOT NULL,
    milestone_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    expected_event_id bigint,
    action text NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goal_milestone_events_action_check CHECK ((action = ANY (ARRAY['complete'::text, 'reopen'::text])))
);


ALTER TABLE public.goal_milestone_events OWNER TO postgres;

--
-- Name: goal_milestone_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_milestone_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.goal_milestone_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: goal_milestones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_milestones (
    id uuid NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.goal_milestones OWNER TO postgres;

--
-- Name: goal_monthly_target_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_monthly_target_revisions (
    id bigint NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    month_start date NOT NULL,
    amount_minor bigint NOT NULL,
    expected_revision_id bigint,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goal_monthly_target_revisions_amount_minor_check CHECK (((amount_minor >= 0) AND (amount_minor <= '999999999999999'::bigint))),
    CONSTRAINT goal_monthly_target_revisions_month_start_check CHECK ((month_start = (date_trunc('month'::text, (month_start)::timestamp with time zone))::date))
);


ALTER TABLE public.goal_monthly_target_revisions OWNER TO postgres;

--
-- Name: goal_monthly_target_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_monthly_target_revisions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.goal_monthly_target_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: goal_purchase_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_purchase_links (
    id uuid NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    expense_event_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goal_purchase_links_amount_minor_check CHECK (((amount_minor >= 1) AND (amount_minor <= '999999999999999'::bigint)))
);


ALTER TABLE public.goal_purchase_links OWNER TO postgres;

--
-- Name: goal_revision_milestones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_revision_milestones (
    revision_id bigint NOT NULL,
    milestone_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    kind text NOT NULL,
    label_en text,
    label_ar text,
    threshold_minor bigint,
    due_date date,
    ordinal integer NOT NULL,
    CONSTRAINT goal_revision_milestones_check CHECK (((label_en IS NOT NULL) OR (label_ar IS NOT NULL))),
    CONSTRAINT goal_revision_milestones_check1 CHECK (((((kind = 'amount'::text) AND (threshold_minor IS NOT NULL) AND ((threshold_minor >= 1) AND (threshold_minor <= '999999999999999'::bigint))) OR ((kind = 'checklist'::text) AND (threshold_minor IS NULL))) IS TRUE)),
    CONSTRAINT goal_revision_milestones_kind_check CHECK ((kind = ANY (ARRAY['amount'::text, 'checklist'::text]))),
    CONSTRAINT goal_revision_milestones_label_ar_check CHECK ((((label_ar IS NULL) OR ((char_length(btrim(label_ar)) >= 1) AND (char_length(btrim(label_ar)) <= 120))) IS TRUE)),
    CONSTRAINT goal_revision_milestones_label_en_check CHECK ((((label_en IS NULL) OR ((char_length(btrim(label_en)) >= 1) AND (char_length(btrim(label_en)) <= 120))) IS TRUE)),
    CONSTRAINT goal_revision_milestones_ordinal_check CHECK (((ordinal >= 0) AND (ordinal <= 19)))
);


ALTER TABLE public.goal_revision_milestones OWNER TO postgres;

--
-- Name: goal_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goal_revisions (
    id bigint NOT NULL,
    goal_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    expected_revision_id bigint,
    name_en text,
    name_ar text,
    note text,
    target_minor bigint NOT NULL,
    deadline date,
    contribution_mode text NOT NULL,
    monthly_minor bigint,
    priority integer NOT NULL,
    state text NOT NULL,
    milestone_count integer NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goal_revisions_check CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT goal_revisions_check1 CHECK (((((contribution_mode = 'manual_monthly'::text) AND (monthly_minor IS NOT NULL) AND ((monthly_minor >= 0) AND (monthly_minor <= '999999999999999'::bigint))) OR ((contribution_mode = 'by_deadline'::text) AND (monthly_minor IS NULL) AND (deadline IS NOT NULL))) IS TRUE)),
    CONSTRAINT goal_revisions_contribution_mode_check CHECK ((contribution_mode = ANY (ARRAY['manual_monthly'::text, 'by_deadline'::text]))),
    CONSTRAINT goal_revisions_milestone_count_check CHECK (((milestone_count >= 0) AND (milestone_count <= 20))),
    CONSTRAINT goal_revisions_name_ar_check CHECK ((((name_ar IS NULL) OR ((char_length(btrim(name_ar)) >= 1) AND (char_length(btrim(name_ar)) <= 120))) IS TRUE)),
    CONSTRAINT goal_revisions_name_en_check CHECK ((((name_en IS NULL) OR ((char_length(btrim(name_en)) >= 1) AND (char_length(btrim(name_en)) <= 120))) IS TRUE)),
    CONSTRAINT goal_revisions_note_check CHECK (((note IS NULL) OR (char_length(note) <= 1000))),
    CONSTRAINT goal_revisions_priority_check CHECK (((priority >= 0) AND (priority <= 999))),
    CONSTRAINT goal_revisions_state_check CHECK ((state = ANY (ARRAY['active'::text, 'paused'::text, 'closed'::text]))),
    CONSTRAINT goal_revisions_target_minor_check CHECK (((target_minor >= 1) AND (target_minor <= '999999999999999'::bigint)))
);


ALTER TABLE public.goal_revisions OWNER TO postgres;

--
-- Name: goal_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_revisions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.goal_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: goals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.goals (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    kind text NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goals_kind_check CHECK ((kind = ANY (ARRAY['reserve'::text, 'purchase'::text])))
);


ALTER TABLE public.goals OWNER TO postgres;

--
-- Name: household_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.household_invitations (
    id uuid DEFAULT extensions.gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    key_version smallint NOT NULL,
    invitee_identity_digest bytea NOT NULL,
    token_digest bytea NOT NULL,
    status public.household_invitation_status DEFAULT 'pending'::public.household_invitation_status NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_by_user_id uuid,
    accepted_at timestamp with time zone,
    cancelled_by_user_id uuid,
    cancelled_at timestamp with time zone,
    CONSTRAINT household_invitation_expiry_check CHECK ((expires_at = (created_at + '7 days'::interval))),
    CONSTRAINT household_invitation_identity_digest_check CHECK ((octet_length(invitee_identity_digest) = 32)),
    CONSTRAINT household_invitation_lifecycle_check CHECK ((((status = 'pending'::public.household_invitation_status) AND (accepted_by_user_id IS NULL) AND (accepted_at IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancelled_at IS NULL)) OR ((status = 'accepted'::public.household_invitation_status) AND (accepted_by_user_id IS NOT NULL) AND (accepted_at IS NOT NULL) AND (cancelled_by_user_id IS NULL) AND (cancelled_at IS NULL)) OR ((status = 'cancelled'::public.household_invitation_status) AND (cancelled_by_user_id IS NOT NULL) AND (cancelled_at IS NOT NULL) AND (accepted_by_user_id IS NULL) AND (accepted_at IS NULL)))),
    CONSTRAINT household_invitation_token_digest_check CHECK ((octet_length(token_digest) = 32))
);

ALTER TABLE ONLY public.household_invitations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.household_invitations OWNER TO postgres;

--
-- Name: household_membership_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.household_membership_events (
    id uuid DEFAULT extensions.gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    subject_user_id uuid,
    request_id uuid NOT NULL,
    request_fingerprint bytea NOT NULL,
    kind public.household_membership_event_kind NOT NULL,
    invitation_id uuid,
    prior_status public.membership_status,
    next_status public.membership_status,
    prior_role public.member_role,
    next_role public.member_role,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT household_membership_events_request_fingerprint_check CHECK ((octet_length(request_fingerprint) = 32)),
    CONSTRAINT household_membership_events_shape_check CHECK ((((kind = ANY (ARRAY['invitation_created'::public.household_membership_event_kind, 'invitation_cancelled'::public.household_membership_event_kind])) AND (invitation_id IS NOT NULL) AND (subject_user_id IS NULL) AND (prior_status IS NULL) AND (next_status IS NULL) AND (prior_role IS NULL) AND (next_role IS NULL)) OR ((kind = 'invitation_accepted'::public.household_membership_event_kind) AND (invitation_id IS NOT NULL) AND (subject_user_id IS NOT NULL) AND (prior_status IS DISTINCT FROM 'active'::public.membership_status) AND (next_status = 'active'::public.membership_status) AND (next_role = 'member'::public.member_role)) OR ((kind = 'member_removed'::public.household_membership_event_kind) AND (invitation_id IS NULL) AND (subject_user_id IS NOT NULL) AND (prior_status = 'active'::public.membership_status) AND (next_status = 'revoked'::public.membership_status) AND (prior_role IS NOT NULL) AND (next_role = prior_role)) OR ((kind = 'member_left'::public.household_membership_event_kind) AND (invitation_id IS NULL) AND (subject_user_id IS NOT NULL) AND (prior_status = 'active'::public.membership_status) AND (next_status = 'left'::public.membership_status) AND (prior_role IS NOT NULL) AND (next_role = prior_role)) OR ((kind = 'member_promoted'::public.household_membership_event_kind) AND (invitation_id IS NULL) AND (subject_user_id IS NOT NULL) AND (prior_status = 'active'::public.membership_status) AND (next_status = 'active'::public.membership_status) AND (prior_role = 'member'::public.member_role) AND (next_role = 'owner'::public.member_role)) OR ((kind = 'member_demoted'::public.household_membership_event_kind) AND (invitation_id IS NULL) AND (subject_user_id IS NOT NULL) AND (prior_status = 'active'::public.membership_status) AND (next_status = 'active'::public.membership_status) AND (prior_role = 'owner'::public.member_role) AND (next_role = 'member'::public.member_role))))
);

ALTER TABLE ONLY public.household_membership_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.household_membership_events OWNER TO postgres;

--
-- Name: loan_postings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.loan_postings (
    event_id uuid NOT NULL,
    loan_id uuid NOT NULL,
    space_id uuid NOT NULL,
    principal_delta_minor bigint NOT NULL,
    repayment_effect_minor bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loan_postings_principal_delta_minor_check CHECK ((principal_delta_minor <> 0))
);


ALTER TABLE public.loan_postings OWNER TO postgres;

--
-- Name: loans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.loans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    direction public.loan_direction NOT NULL,
    person_name text NOT NULL,
    currency public.currency_code NOT NULL,
    effective_date date NOT NULL,
    due_date date,
    note text,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loans_check CHECK (((due_date IS NULL) OR (due_date >= effective_date))),
    CONSTRAINT loans_note_check CHECK (((note IS NULL) OR (char_length(note) <= 2000))),
    CONSTRAINT loans_person_name_check CHECK (((char_length(btrim(person_name)) >= 1) AND (char_length(btrim(person_name)) <= 120)))
);


ALTER TABLE public.loans OWNER TO postgres;

--
-- Name: loan_balances; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.loan_balances WITH (security_invoker='true') AS
 SELECT loan.id AS loan_id,
    loan.space_id,
    loan.direction,
    loan.currency,
    (COALESCE(sum(posting.principal_delta_minor), (0)::numeric))::bigint AS outstanding_minor
   FROM (public.loans loan
     LEFT JOIN public.loan_postings posting ON ((posting.loan_id = loan.id)))
  GROUP BY loan.id, loan.space_id, loan.direction, loan.currency;


ALTER VIEW public.loan_balances OWNER TO postgres;

--
-- Name: loan_monthly_target_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.loan_monthly_target_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    loan_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint bytea NOT NULL,
    target_month date NOT NULL,
    target_minor bigint NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loan_monthly_target_revisions_target_minor_check CHECK ((target_minor >= 0))
);


ALTER TABLE public.loan_monthly_target_revisions OWNER TO postgres;

--
-- Name: monthly_budget_plan_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.monthly_budget_plan_revisions (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint bytea NOT NULL,
    plan_kind text NOT NULL,
    month_start date NOT NULL,
    currency public.currency_code NOT NULL,
    category_id uuid,
    category_kind public.category_kind,
    amount_minor bigint NOT NULL,
    expected_revision_id bigint,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT monthly_budget_plan_revisions_amount_minor_check CHECK (((amount_minor >= 0) AND (amount_minor <= '999999999999999'::bigint))),
    CONSTRAINT monthly_budget_plan_revisions_month_start_check CHECK ((month_start = (date_trunc('month'::text, (month_start)::timestamp with time zone))::date)),
    CONSTRAINT monthly_budget_plan_revisions_plan_kind_check CHECK ((plan_kind = ANY (ARRAY['income'::text, 'expense_category'::text]))),
    CONSTRAINT monthly_budget_plan_revisions_shape_check CHECK (((((plan_kind = 'income'::text) AND (category_id IS NULL) AND (category_kind IS NULL)) OR ((plan_kind = 'expense_category'::text) AND (category_id IS NOT NULL) AND (category_kind = 'expense'::public.category_kind))) IS TRUE))
);


ALTER TABLE public.monthly_budget_plan_revisions OWNER TO postgres;

--
-- Name: monthly_budget_plan_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.monthly_budget_plan_revisions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.monthly_budget_plan_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: occurrence_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.occurrence_events (
    id bigint NOT NULL,
    occurrence_id uuid NOT NULL,
    space_id uuid NOT NULL,
    expected_event_id bigint,
    action text NOT NULL,
    linked_event_id uuid,
    link_amount_minor bigint,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT occurrence_events_action_check CHECK ((action = ANY (ARRAY['skip'::text, 'reopen'::text, 'link'::text, 'confirm'::text]))),
    CONSTRAINT occurrence_events_check CHECK (((expected_event_id IS NULL) OR (expected_event_id < id))),
    CONSTRAINT occurrence_events_check1 CHECK ((((action = ANY (ARRAY['link'::text, 'confirm'::text])) = ((linked_event_id IS NOT NULL) AND (link_amount_minor IS NOT NULL) AND (link_amount_minor > 0))) IS TRUE))
);


ALTER TABLE public.occurrence_events OWNER TO postgres;

--
-- Name: occurrence_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.occurrence_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.occurrence_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    name text NOT NULL,
    name_key text GENERATED ALWAYS AS (private.payee_name_key(name)) STORED,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payees_name_canonical_check CHECK (((name = private.canonical_payee_name(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 120)))),
    CONSTRAINT payees_name_key_nonempty_check CHECK ((btrim(name_key) <> ''::text))
);


ALTER TABLE public.payees OWNER TO postgres;

--
-- Name: planning_command_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.planning_command_receipts (
    sequence_id bigint NOT NULL,
    space_id uuid NOT NULL,
    request_id uuid NOT NULL,
    command text NOT NULL,
    fingerprint bytea NOT NULL,
    actor_id uuid NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planning_command_receipts_command_check CHECK (((char_length(command) >= 1) AND (char_length(command) <= 80))),
    CONSTRAINT planning_command_receipts_fingerprint_check CHECK ((octet_length(fingerprint) = 32)),
    CONSTRAINT planning_command_receipts_result_check CHECK ((((jsonb_typeof(result) = 'object'::text) AND (octet_length((result)::text) <= 16384)) IS TRUE))
);


ALTER TABLE public.planning_command_receipts OWNER TO postgres;

--
-- Name: planning_command_receipts_sequence_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.planning_command_receipts ALTER COLUMN sequence_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.planning_command_receipts_sequence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rollover_policy_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rollover_policy_revisions (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    root_id uuid NOT NULL,
    root_kind public.category_kind DEFAULT 'expense'::public.category_kind NOT NULL,
    enabled boolean NOT NULL,
    expected_revision_id bigint,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rollover_policy_revisions_check CHECK ((((expected_revision_id IS NULL) OR (expected_revision_id < id)) IS TRUE)),
    CONSTRAINT rollover_policy_revisions_root_kind_check CHECK ((root_kind = 'expense'::public.category_kind))
);


ALTER TABLE public.rollover_policy_revisions OWNER TO postgres;

--
-- Name: rollover_policy_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.rollover_policy_revisions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rollover_policy_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schedule_revisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schedule_revisions (
    id bigint NOT NULL,
    schedule_id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    expected_revision_id bigint,
    state text NOT NULL,
    name_en text,
    name_ar text,
    expected_minor bigint NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    cadence text NOT NULL,
    interval_count integer NOT NULL,
    category_id uuid,
    loan_id uuid,
    funding_goal_id uuid,
    preferred_wallet_id uuid,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schedule_revisions_cadence_check CHECK ((cadence = ANY (ARRAY['weekly'::text, 'monthly'::text, 'yearly'::text, 'semimonthly'::text, 'monthly_last_business_day'::text]))),
    CONSTRAINT schedule_revisions_check CHECK (((expected_revision_id IS NULL) OR (expected_revision_id < id))),
    CONSTRAINT schedule_revisions_check1 CHECK (((name_en IS NOT NULL) OR (name_ar IS NOT NULL))),
    CONSTRAINT schedule_revisions_check2 CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT schedule_revisions_expected_minor_check CHECK (((expected_minor >= 1) AND (expected_minor <= '999999999999999'::bigint))),
    CONSTRAINT schedule_revisions_interval_count_check CHECK (((interval_count >= 1) AND (interval_count <= 12))),
    CONSTRAINT schedule_revisions_name_ar_check CHECK ((((name_ar IS NULL) OR ((char_length(btrim(name_ar)) >= 1) AND (char_length(btrim(name_ar)) <= 80))) IS TRUE)),
    CONSTRAINT schedule_revisions_name_en_check CHECK ((((name_en IS NULL) OR ((char_length(btrim(name_en)) >= 1) AND (char_length(btrim(name_en)) <= 80))) IS TRUE)),
    CONSTRAINT schedule_revisions_state_check CHECK ((state = ANY (ARRAY['active'::text, 'paused'::text, 'ended'::text])))
);


ALTER TABLE public.schedule_revisions OWNER TO postgres;

--
-- Name: schedule_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.schedule_revisions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schedule_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scheduled_occurrences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.scheduled_occurrences (
    id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    source_revision_id bigint NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    due_date date NOT NULL,
    expected_minor bigint NOT NULL,
    category_id uuid,
    loan_id uuid,
    funding_goal_id uuid,
    preferred_wallet_id uuid,
    request_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scheduled_occurrences_expected_minor_check CHECK (((expected_minor >= 1) AND (expected_minor <= '999999999999999'::bigint)))
);


ALTER TABLE public.scheduled_occurrences OWNER TO postgres;

--
-- Name: schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schedules (
    id uuid NOT NULL,
    space_id uuid NOT NULL,
    currency public.currency_code NOT NULL,
    kind text NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schedules_kind_check CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text, 'debt_payment'::text])))
);


ALTER TABLE public.schedules OWNER TO postgres;

--
-- Name: space_memberships; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.space_memberships (
    space_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.member_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.membership_status DEFAULT 'active'::public.membership_status NOT NULL,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    ended_by_user_id uuid,
    CONSTRAINT space_memberships_end_actor_check CHECK (((status = 'active'::public.membership_status) OR ((status = 'left'::public.membership_status) AND (ended_by_user_id = user_id)) OR ((status = 'revoked'::public.membership_status) AND (ended_by_user_id <> user_id)))),
    CONSTRAINT space_memberships_lifecycle_check CHECK ((((status = 'active'::public.membership_status) AND (ended_at IS NULL) AND (ended_by_user_id IS NULL)) OR ((status = ANY (ARRAY['revoked'::public.membership_status, 'left'::public.membership_status])) AND (ended_at IS NOT NULL) AND (ended_by_user_id IS NOT NULL)))),
    CONSTRAINT space_memberships_lifecycle_time_check CHECK (((activated_at >= created_at) AND ((ended_at IS NULL) OR (ended_at >= activated_at))))
);


ALTER TABLE public.space_memberships OWNER TO postgres;

--
-- Name: spaces; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.space_kind NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    payday_day integer DEFAULT 1 NOT NULL,
    CONSTRAINT spaces_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
    CONSTRAINT spaces_payday_day_range CHECK (((payday_day >= 1) AND (payday_day <= 31)))
);


ALTER TABLE public.spaces OWNER TO postgres;

--
-- Name: COLUMN spaces.timezone; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.spaces.timezone IS 'IANA time zone name (e.g. Asia/Beirut). Governs the space''s "today" and current month.';


--
-- Name: COLUMN spaces.payday_day; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.spaces.payday_day IS 'Day of month the budget period starts (1-31). 1 = calendar months.';


--
-- Name: wallet_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallet_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    space_id uuid NOT NULL,
    wallet_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_movements_amount_minor_check CHECK ((amount_minor <> 0))
);


ALTER TABLE public.wallet_movements OWNER TO postgres;

--
-- Name: wallet_balances; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.wallet_balances WITH (security_invoker='true') AS
 SELECT wallet.id AS wallet_id,
    wallet.space_id,
    wallet.currency,
    (COALESCE(sum(movement.amount_minor), (0)::numeric))::bigint AS amount_minor
   FROM (public.wallets wallet
     LEFT JOIN public.wallet_movements movement ON ((movement.wallet_id = wallet.id)))
  GROUP BY wallet.id, wallet.space_id, wallet.currency;


ALTER VIEW public.wallet_balances OWNER TO postgres;

--
-- Name: wallet_command_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallet_command_requests (
    space_id uuid NOT NULL,
    request_id uuid NOT NULL,
    command_kind text NOT NULL,
    request_fingerprint bytea NOT NULL,
    wallet_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    previous_name text,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wallet_command_requests_kind_check CHECK ((command_kind = ANY (ARRAY['rename_wallet'::text, 'archive_wallet'::text, 'restore_wallet'::text]))),
    CONSTRAINT wallet_command_requests_names_check CHECK (
CASE
    WHEN (command_kind = 'rename_wallet'::text) THEN ((previous_name IS NOT NULL) AND (name IS NOT NULL) AND (name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 120)))
    ELSE ((previous_name IS NULL) AND (name IS NULL))
END)
);


ALTER TABLE public.wallet_command_requests OWNER TO postgres;

--
-- PostgreSQL database dump complete
--



-- Put the session settings the export changed back, so later migrations on this connection are unaffected.
select pg_catalog.set_config('search_path', '"$user", public, extensions', false);
reset statement_timeout; reset lock_timeout; reset idle_in_transaction_session_timeout; reset transaction_timeout;
reset check_function_bodies; reset row_security; reset client_min_messages; reset xmloption;
