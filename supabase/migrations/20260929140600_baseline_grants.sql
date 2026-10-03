-- Baseline part 8 of 9: grants and ownership. Fail closed: every function, table and sequence in public and private
-- is stripped of anon, authenticated and service_role first, then only the listed grants are given back.
-- (The platform's default privileges would otherwise leave anon and service_role able to execute new functions.)
-- Grants come before the ownership transfer so the household owner role is recorded as their grantor.

revoke all on all functions in schema public, private from anon, authenticated, service_role;
revoke all on all tables in schema public, private from anon, authenticated, service_role;
revoke all on all sequences in schema public, private from anon, authenticated, service_role;

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
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO household_command_owner;


--
-- Name: FUNCTION active_household_invitation_key_version(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.active_household_invitation_key_version() FROM PUBLIC;
GRANT ALL ON FUNCTION private.active_household_invitation_key_version() TO household_command_owner;


--
-- Name: FUNCTION allocate_planning_income(p_income text, p_groups jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.allocate_planning_income(p_income text, p_groups jsonb) FROM PUBLIC;


--
-- Name: FUNCTION allocation_snapshot_carry(p_snapshot_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.allocation_snapshot_carry(p_snapshot_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION allocation_snapshot_carry_needs_review(p_snapshot_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.allocation_snapshot_carry_needs_review(p_snapshot_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION arabic_category_key(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.arabic_category_key(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION assert_space_membership_invariant(p_space_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.assert_space_membership_invariant(p_space_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION budget_month_close_facts(p_space_id uuid, p_currency public.currency_code, p_month date, p_snapshot_id bigint, p_fact_cap integer); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.budget_month_close_facts(p_space_id uuid, p_currency public.currency_code, p_month date, p_snapshot_id bigint, p_fact_cap integer) FROM PUBLIC;


--
-- Name: FUNCTION budget_month_close_preview(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.budget_month_close_preview(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION canonical_category_name(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.canonical_category_name(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION canonical_payee_name(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.canonical_payee_name(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_month(p_snapshot_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_month(p_snapshot_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_month_from_commitment(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_month_from_commitment() FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_month_from_goal_line(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_month_from_goal_line() FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_month_from_group(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_month_from_group() FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_month_from_header(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_month_from_header() FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_month_from_root(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_month_from_root() FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_template(p_template_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_template(p_template_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_template_from_header(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_template_from_header() FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_template_from_line(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_template_from_line() FROM PUBLIC;


--
-- Name: FUNCTION check_allocation_template_from_root(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_allocation_template_from_root() FROM PUBLIC;


--
-- Name: FUNCTION check_budget_month_carry_from_link(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_budget_month_carry_from_link() FROM PUBLIC;


--
-- Name: FUNCTION check_budget_month_carry_links(p_target_snapshot_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_budget_month_carry_links(p_target_snapshot_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_budget_month_close(p_close_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_budget_month_close(p_close_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_budget_month_close_from_header(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_budget_month_close_from_header() FROM PUBLIC;


--
-- Name: FUNCTION check_budget_month_close_from_root(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_budget_month_close_from_root() FROM PUBLIC;


--
-- Name: FUNCTION check_goal_definition(p_revision_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_definition(p_revision_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_goal_definition_from_header(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_definition_from_header() FROM PUBLIC;


--
-- Name: FUNCTION check_goal_definition_from_milestone(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_definition_from_milestone() FROM PUBLIC;


--
-- Name: FUNCTION check_goal_earmark_event(p_event_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_earmark_event(p_event_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_goal_earmark_event_from_header(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_earmark_event_from_header() FROM PUBLIC;


--
-- Name: FUNCTION check_goal_earmark_event_from_line(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_earmark_event_from_line() FROM PUBLIC;


--
-- Name: FUNCTION check_goal_milestone_event(p_event_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_milestone_event(p_event_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_goal_milestone_event_from_event(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_goal_milestone_event_from_event() FROM PUBLIC;


--
-- Name: FUNCTION check_occurrence_event(p_event_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_occurrence_event(p_event_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_occurrence_event_from_row(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_occurrence_event_from_row() FROM PUBLIC;


--
-- Name: FUNCTION check_rollover_policy_from_row(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_rollover_policy_from_row() FROM PUBLIC;


--
-- Name: FUNCTION check_rollover_policy_revision(p_revision_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_rollover_policy_revision(p_revision_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_schedule_revision(p_revision_id bigint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_schedule_revision(p_revision_id bigint) FROM PUBLIC;


--
-- Name: FUNCTION check_schedule_revision_from_header(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.check_schedule_revision_from_header() FROM PUBLIC;


--
-- Name: FUNCTION derive_household_invitation_token(p_key_version smallint, p_actor_user_id uuid, p_request_id uuid, p_space_id uuid, p_identity_digest bytea); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.derive_household_invitation_token(p_key_version smallint, p_actor_user_id uuid, p_request_id uuid, p_space_id uuid, p_identity_digest bytea) FROM PUBLIC;
GRANT ALL ON FUNCTION private.derive_household_invitation_token(p_key_version smallint, p_actor_user_id uuid, p_request_id uuid, p_space_id uuid, p_identity_digest bytea) TO household_command_owner;


--
-- Name: FUNCTION enforce_household_invitation_space(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_household_invitation_space() FROM PUBLIC;


--
-- Name: FUNCTION enforce_space_membership_invariant(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_space_membership_invariant() FROM PUBLIC;


--
-- Name: FUNCTION enforce_space_row_membership_invariant(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.enforce_space_row_membership_invariant() FROM PUBLIC;


--
-- Name: FUNCTION english_category_key(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.english_category_key(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION goal_cash_pool(p_space_id uuid, p_currency public.currency_code, p_as_of date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.goal_cash_pool(p_space_id uuid, p_currency public.currency_code, p_as_of date) FROM PUBLIC;


--
-- Name: FUNCTION goal_coverage_set(p_space_id uuid, p_currency public.currency_code, p_as_of date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.goal_coverage_set(p_space_id uuid, p_currency public.currency_code, p_as_of date) FROM PUBLIC;


--
-- Name: FUNCTION goal_financing_state(p_goal_id uuid, p_as_of date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.goal_financing_state(p_goal_id uuid, p_as_of date) FROM PUBLIC;


--
-- Name: FUNCTION goal_monthly_extras(p_goal_id uuid, p_kind text, p_target_minor bigint, p_deadline date, p_covered_minor numeric, p_fulfilled_minor numeric, p_month date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.goal_monthly_extras(p_goal_id uuid, p_kind text, p_target_minor bigint, p_deadline date, p_covered_minor numeric, p_fulfilled_minor numeric, p_month date) FROM PUBLIC;


--
-- Name: FUNCTION goal_relevant_set(p_space_id uuid, p_currency public.currency_code, p_as_of date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.goal_relevant_set(p_space_id uuid, p_currency public.currency_code, p_as_of date) FROM PUBLIC;


--
-- Name: FUNCTION goal_space_earmarked_total(p_space_id uuid, p_currency public.currency_code, p_as_of date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.goal_space_earmarked_total(p_space_id uuid, p_currency public.currency_code, p_as_of date) FROM PUBLIC;


--
-- Name: FUNCTION guard_category_archive_transition(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_category_archive_transition() FROM PUBLIC;


--
-- Name: FUNCTION guard_wallet_update(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.guard_wallet_update() FROM PUBLIC;


--
-- Name: FUNCTION household_actor_email_confirmed(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_actor_email_confirmed() FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_actor_email_confirmed() TO household_command_owner;


--
-- Name: FUNCTION household_actor_identity_digest(p_key_version smallint); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_actor_identity_digest(p_key_version smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_actor_identity_digest(p_key_version smallint) TO household_command_owner;


--
-- Name: FUNCTION household_actor_user_id(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_actor_user_id() FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_actor_user_id() TO household_command_owner;


--
-- Name: FUNCTION household_command_fingerprint(p_canonical_input text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_command_fingerprint(p_canonical_input text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_command_fingerprint(p_canonical_input text) TO household_command_owner;


--
-- Name: FUNCTION household_execute_invitation_creation(p_space_id uuid, p_request_id uuid, p_invitee_email text); Type: ACL; Schema: private; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION private.household_execute_invitation_creation(p_space_id uuid, p_request_id uuid, p_invitee_email text) FROM PUBLIC;


--
-- Name: FUNCTION household_execute_invitation_listing(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid); Type: ACL; Schema: private; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION private.household_execute_invitation_listing(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION household_execute_member_listing(p_space_id uuid, p_limit integer, p_after_user_id uuid); Type: ACL; Schema: private; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION private.household_execute_member_listing(p_space_id uuid, p_limit integer, p_after_user_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION household_has_active_identity(p_space_id uuid, p_key_version smallint, p_identity_digest bytea); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_has_active_identity(p_space_id uuid, p_key_version smallint, p_identity_digest bytea) FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_has_active_identity(p_space_id uuid, p_key_version smallint, p_identity_digest bytea) TO household_command_owner;


--
-- Name: FUNCTION household_identity_digest(p_key_version smallint, p_normalized_email text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_identity_digest(p_key_version smallint, p_normalized_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_identity_digest(p_key_version smallint, p_normalized_email text) TO household_command_owner;


--
-- Name: FUNCTION household_invitation_token_digest(p_token text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_invitation_token_digest(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_invitation_token_digest(p_token text) TO household_command_owner;


--
-- Name: FUNCTION household_space_kind(p_space_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.household_space_kind(p_space_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.household_space_kind(p_space_id uuid) TO household_command_owner;


--
-- Name: FUNCTION is_active_member(p_space_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_active_member(p_space_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_active_member(p_space_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.is_active_member(p_space_id uuid) TO household_command_owner;


--
-- Name: FUNCTION is_active_owner(p_space_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.is_active_owner(p_space_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_active_owner(p_space_id uuid) TO household_command_owner;


--
-- Name: FUNCTION lock_category_request(p_space_id uuid, p_request_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_category_request(p_space_id uuid, p_request_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION lock_financial_request(p_space_id uuid, p_request_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_financial_request(p_space_id uuid, p_request_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION lock_household_invitee(p_space_id uuid, p_identity_digest bytea); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_household_invitee(p_space_id uuid, p_identity_digest bytea) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lock_household_invitee(p_space_id uuid, p_identity_digest bytea) TO household_command_owner;


--
-- Name: FUNCTION lock_household_request(p_actor_user_id uuid, p_request_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_household_request(p_actor_user_id uuid, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lock_household_request(p_actor_user_id uuid, p_request_id uuid) TO household_command_owner;


--
-- Name: FUNCTION lock_household_space(p_space_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_household_space(p_space_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.lock_household_space(p_space_id uuid) TO household_command_owner;


--
-- Name: FUNCTION lock_planning_actor(p_space_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_planning_actor(p_space_id uuid) FROM PUBLIC;


--
-- Name: TABLE wallets; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.wallets TO authenticated;


--
-- Name: FUNCTION lock_space_wallet(p_space_id uuid, p_wallet_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.lock_space_wallet(p_space_id uuid, p_wallet_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION month_copy_preview(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.month_copy_preview(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) FROM PUBLIC;


--
-- Name: FUNCTION normalize_household_invitee_email(p_email text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.normalize_household_invitee_email(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.normalize_household_invitee_email(p_email text) TO household_command_owner;


--
-- Name: FUNCTION parse_nonnegative_minor_amount(p_amount_minor text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.parse_nonnegative_minor_amount(p_amount_minor text) FROM PUBLIC;


--
-- Name: FUNCTION parse_positive_minor_amount(p_amount_minor text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.parse_positive_minor_amount(p_amount_minor text) FROM PUBLIC;


--
-- Name: FUNCTION payee_name_key(p_value text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.payee_name_key(p_value text) FROM PUBLIC;


--
-- Name: FUNCTION planning_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_as_of date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_cash_commitments(p_space_id uuid, p_currency public.currency_code, p_as_of date) FROM PUBLIC;


--
-- Name: FUNCTION planning_child_request(p_parent uuid, p_operation text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_child_request(p_parent uuid, p_operation text) FROM PUBLIC;


--
-- Name: FUNCTION planning_expense_buckets(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_month_end date, p_horizon_end date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_expense_buckets(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_month_end date, p_horizon_end date) FROM PUBLIC;


--
-- Name: FUNCTION planning_fingerprint(p_command text, p_actor uuid, p_payload jsonb); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_fingerprint(p_command text, p_actor uuid, p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION planning_goal_bill_coverage(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_horizon_end date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_goal_bill_coverage(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_horizon_end date) FROM PUBLIC;


--
-- Name: FUNCTION planning_materialization_gap(p_space_id uuid, p_currency public.currency_code, p_from date, p_to date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_materialization_gap(p_space_id uuid, p_currency public.currency_code, p_from date, p_to date) FROM PUBLIC;


--
-- Name: FUNCTION planning_ordinary_activity(p_space_id uuid, p_from date, p_to date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_ordinary_activity(p_space_id uuid, p_from date, p_to date) FROM PUBLIC;


--
-- Name: FUNCTION planning_replay(p_space_id uuid, p_request_id uuid, p_command text, p_actor uuid, p_fingerprint bytea); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_replay(p_space_id uuid, p_request_id uuid, p_command text, p_actor uuid, p_fingerprint bytea) FROM PUBLIC;


--
-- Name: FUNCTION planning_unpaid_backlog_count(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_to date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.planning_unpaid_backlog_count(p_space_id uuid, p_currency public.currency_code, p_as_of date, p_to date) FROM PUBLIC;


--
-- Name: FUNCTION reject_category_history_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_category_history_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_household_membership_event_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_household_membership_event_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_monthly_budget_plan_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_monthly_budget_plan_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_posted_history_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_posted_history_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_reversal_before_original(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_reversal_before_original() FROM PUBLIC;


--
-- Name: FUNCTION reject_subcategory_budget_target(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_subcategory_budget_target() FROM PUBLIC;


--
-- Name: FUNCTION reject_wallet_command_history_mutation(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_wallet_command_history_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reject_wallet_deletion(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.reject_wallet_deletion() FROM PUBLIC;


--
-- Name: FUNCTION replay_wallet_command(p_space_id uuid, p_request_id uuid, p_command_kind text, p_fingerprint bytea, p_wallet_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.replay_wallet_command(p_space_id uuid, p_request_id uuid, p_command_kind text, p_fingerprint bytea, p_wallet_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION require_active_movement_wallet(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.require_active_movement_wallet() FROM PUBLIC;


--
-- Name: FUNCTION require_table_owner_write(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.require_table_owner_write() FROM PUBLIC;


--
-- Name: FUNCTION require_wallet_command_actor(p_space_id uuid, p_request_id uuid, p_wallet_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.require_wallet_command_actor(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION schedule_candidate_due_dates(p_starts_on date, p_cadence text, p_interval_count integer, p_ends_on date, p_from_date date, p_to_date date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.schedule_candidate_due_dates(p_starts_on date, p_cadence text, p_interval_count integer, p_ends_on date, p_from_date date, p_to_date date) FROM PUBLIC;


--
-- Name: FUNCTION schedule_occurrence_candidates(p_space_id uuid, p_from_date date, p_to_date date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.schedule_occurrence_candidates(p_space_id uuid, p_from_date date, p_to_date date) FROM PUBLIC;


--
-- Name: FUNCTION schedule_occurrence_id(p_schedule_id uuid, p_due_date date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.schedule_occurrence_id(p_schedule_id uuid, p_due_date date) FROM PUBLIC;


--
-- Name: FUNCTION schedule_occurrence_settlement(p_occurrence_id uuid, p_as_of date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.schedule_occurrence_settlement(p_occurrence_id uuid, p_as_of date) FROM PUBLIC;


--
-- Name: FUNCTION set_monthly_budget_plan(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint, p_plan_kind text); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.set_monthly_budget_plan(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint, p_plan_kind text) FROM PUBLIC;


--
-- Name: FUNCTION space_date(p_space_id uuid, p_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.space_date(p_space_id uuid, p_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION space_period_anchor(p_space_id uuid, p_month date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.space_period_anchor(p_space_id uuid, p_month date) FROM PUBLIC;


--
-- Name: FUNCTION space_period_bounds(p_space_id uuid, p_month date); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.space_period_bounds(p_space_id uuid, p_month date) FROM PUBLIC;


--
-- Name: FUNCTION space_period_start(p_space_id uuid, p_at timestamp with time zone); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.space_period_start(p_space_id uuid, p_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION space_today(p_space_id uuid); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.space_today(p_space_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION validate_category_parent(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_category_parent() FROM PUBLIC;


--
-- Name: FUNCTION validate_reversal_category_copy(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_reversal_category_copy() FROM PUBLIC;


--
-- Name: FUNCTION validate_space_timezone(); Type: ACL; Schema: private; Owner: postgres
--

REVOKE ALL ON FUNCTION private.validate_space_timezone() FROM PUBLIC;


--
-- Name: FUNCTION accept_household_invitation(p_request_id uuid, p_invitation_token text); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.accept_household_invitation(p_request_id uuid, p_invitation_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_household_invitation(p_request_id uuid, p_invitation_token text) TO authenticated;


--
-- Name: FUNCTION allocation_category_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint, p_group_id uuid, p_after_root_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.allocation_category_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint, p_group_id uuid, p_after_root_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocation_category_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint, p_group_id uuid, p_after_root_id uuid, p_limit integer) TO authenticated;


--
-- Name: FUNCTION allocation_history_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_before_id bigint, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.allocation_history_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_before_id bigint, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocation_history_page(p_space_id uuid, p_month date, p_currency public.currency_code, p_before_id bigint, p_limit integer) TO authenticated;


--
-- Name: FUNCTION allocation_month_state(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.allocation_month_state(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocation_month_state(p_space_id uuid, p_month date, p_currency public.currency_code, p_snapshot_id bigint) TO authenticated;


--
-- Name: FUNCTION allocation_template_head(p_space_id uuid, p_currency public.currency_code); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.allocation_template_head(p_space_id uuid, p_currency public.currency_code) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocation_template_head(p_space_id uuid, p_currency public.currency_code) TO authenticated;


--
-- Name: FUNCTION allocation_trend(p_space_id uuid, p_currency public.currency_code, p_first_month date, p_month_count integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.allocation_trend(p_space_id uuid, p_currency public.currency_code, p_first_month date, p_month_count integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocation_trend(p_space_id uuid, p_currency public.currency_code, p_first_month date, p_month_count integer) TO authenticated;


--
-- Name: FUNCTION archive_category(p_space_id uuid, p_request_id uuid, p_category_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.archive_category(p_space_id uuid, p_request_id uuid, p_category_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.archive_category(p_space_id uuid, p_request_id uuid, p_category_id uuid) TO authenticated;


--
-- Name: FUNCTION archive_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.archive_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.archive_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) TO authenticated;


--
-- Name: FUNCTION available_cash_summary(p_space_id uuid, p_currency public.currency_code, p_as_of_date date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.available_cash_summary(p_space_id uuid, p_currency public.currency_code, p_as_of_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.available_cash_summary(p_space_id uuid, p_currency public.currency_code, p_as_of_date date) TO authenticated;


--
-- Name: FUNCTION cancel_household_invitation(p_space_id uuid, p_request_id uuid, p_invitation_id uuid); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.cancel_household_invitation(p_space_id uuid, p_request_id uuid, p_invitation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_household_invitation(p_space_id uuid, p_request_id uuid, p_invitation_id uuid) TO authenticated;


--
-- Name: FUNCTION cash_outlook(p_space_id uuid, p_currency public.currency_code, p_start_date date, p_days integer, p_scenario text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cash_outlook(p_space_id uuid, p_currency public.currency_code, p_start_date date, p_days integer, p_scenario text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cash_outlook(p_space_id uuid, p_currency public.currency_code, p_start_date date, p_days integer, p_scenario text) TO authenticated;


--
-- Name: FUNCTION close_budget_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint, p_accepted_preview_hash text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.close_budget_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint, p_accepted_preview_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_budget_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint, p_accepted_preview_hash text) TO authenticated;


--
-- Name: FUNCTION confirm_scheduled_occurrence(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.confirm_scheduled_occurrence(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_scheduled_occurrence(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_actual_amount_minor text, p_effective_date date, p_wallet_id uuid) TO authenticated;


--
-- Name: FUNCTION copy_allocation_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.copy_allocation_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.copy_allocation_month(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date, p_expected_target_snapshot_id bigint, p_accepted_preview_hash text) TO authenticated;


--
-- Name: FUNCTION create_category(p_space_id uuid, p_request_id uuid, p_kind public.category_kind, p_name_en text, p_name_ar text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_category(p_space_id uuid, p_request_id uuid, p_kind public.category_kind, p_name_en text, p_name_ar text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_category(p_space_id uuid, p_request_id uuid, p_kind public.category_kind, p_name_en text, p_name_ar text) TO authenticated;


--
-- Name: FUNCTION create_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_definition jsonb, p_milestones jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_definition jsonb, p_milestones jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_definition jsonb, p_milestones jsonb) TO authenticated;


--
-- Name: FUNCTION create_household_invitation(p_space_id uuid, p_request_id uuid, p_invitee_email text); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.create_household_invitation(p_space_id uuid, p_request_id uuid, p_invitee_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_household_invitation(p_space_id uuid, p_request_id uuid, p_invitee_email text) TO authenticated;


--
-- Name: FUNCTION create_space(p_name text, p_kind public.space_kind); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_space(p_name text, p_kind public.space_kind) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_space(p_name text, p_kind public.space_kind) TO authenticated;


--
-- Name: FUNCTION create_subcategory(p_space_id uuid, p_request_id uuid, p_parent_category_id uuid, p_name_en text, p_name_ar text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_subcategory(p_space_id uuid, p_request_id uuid, p_parent_category_id uuid, p_name_en text, p_name_ar text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_subcategory(p_space_id uuid, p_request_id uuid, p_parent_category_id uuid, p_name_en text, p_name_ar text) TO authenticated;


--
-- Name: FUNCTION create_wallet(p_space_id uuid, p_name text, p_currency public.currency_code); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_wallet(p_space_id uuid, p_name text, p_currency public.currency_code) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_wallet(p_space_id uuid, p_name text, p_currency public.currency_code) TO authenticated;


--
-- Name: FUNCTION describe_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_payee_name text, p_note text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.describe_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_payee_name text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.describe_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_payee_name text, p_note text) TO authenticated;


--
-- Name: FUNCTION find_planning_command(p_space_id uuid, p_request_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.find_planning_command(p_space_id uuid, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_planning_command(p_space_id uuid, p_request_id uuid) TO authenticated;


--
-- Name: FUNCTION get_category_command_result(p_space_id uuid, p_request_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_category_command_result(p_space_id uuid, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_category_command_result(p_space_id uuid, p_request_id uuid) TO authenticated;


--
-- Name: FUNCTION get_wallet_command_result(p_space_id uuid, p_request_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_wallet_command_result(p_space_id uuid, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_wallet_command_result(p_space_id uuid, p_request_id uuid) TO authenticated;


--
-- Name: FUNCTION goal_detail(p_space_id uuid, p_goal_id uuid, p_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.goal_detail(p_space_id uuid, p_goal_id uuid, p_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.goal_detail(p_space_id uuid, p_goal_id uuid, p_month date) TO authenticated;


--
-- Name: FUNCTION goal_history_page(p_space_id uuid, p_goal_id uuid, p_before_created_at timestamp with time zone, p_before_source_kind text, p_before_source_id text, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.goal_history_page(p_space_id uuid, p_goal_id uuid, p_before_created_at timestamp with time zone, p_before_source_kind text, p_before_source_id text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.goal_history_page(p_space_id uuid, p_goal_id uuid, p_before_created_at timestamp with time zone, p_before_source_kind text, p_before_source_id text, p_limit integer) TO authenticated;


--
-- Name: FUNCTION goal_page(p_space_id uuid, p_currency public.currency_code, p_state_filter text, p_after_created_at timestamp with time zone, p_after_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.goal_page(p_space_id uuid, p_currency public.currency_code, p_state_filter text, p_after_created_at timestamp with time zone, p_after_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.goal_page(p_space_id uuid, p_currency public.currency_code, p_state_filter text, p_after_created_at timestamp with time zone, p_after_id uuid, p_limit integer) TO authenticated;


--
-- Name: FUNCTION journal_search_page(p_space_id uuid, p_from date, p_to date, p_wallet_id uuid, p_root_category_id uuid, p_payee_id uuid, p_min_amount_minor bigint, p_max_amount_minor bigint, p_query text, p_cursor text, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.journal_search_page(p_space_id uuid, p_from date, p_to date, p_wallet_id uuid, p_root_category_id uuid, p_payee_id uuid, p_min_amount_minor bigint, p_max_amount_minor bigint, p_query text, p_cursor text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.journal_search_page(p_space_id uuid, p_from date, p_to date, p_wallet_id uuid, p_root_category_id uuid, p_payee_id uuid, p_min_amount_minor bigint, p_max_amount_minor bigint, p_query text, p_cursor text, p_limit integer) TO authenticated;


--
-- Name: FUNCTION leave_household_space(p_space_id uuid, p_request_id uuid); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.leave_household_space(p_space_id uuid, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.leave_household_space(p_space_id uuid, p_request_id uuid) TO authenticated;


--
-- Name: FUNCTION link_goal_purchase(p_space_id uuid, p_request_id uuid, p_expense_event_id uuid, p_lines jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.link_goal_purchase(p_space_id uuid, p_request_id uuid, p_expense_event_id uuid, p_lines jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_goal_purchase(p_space_id uuid, p_request_id uuid, p_expense_event_id uuid, p_lines jsonb) TO authenticated;


--
-- Name: FUNCTION link_scheduled_payment(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_event_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.link_scheduled_payment(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_event_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_scheduled_payment(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_event_id uuid, p_amount_minor text, p_expected_event_id bigint) TO authenticated;


--
-- Name: FUNCTION list_household_invitations(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.list_household_invitations(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_household_invitations(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid) TO authenticated;


--
-- Name: FUNCTION list_household_members(p_space_id uuid, p_limit integer, p_after_user_id uuid); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.list_household_members(p_space_id uuid, p_limit integer, p_after_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_household_members(p_space_id uuid, p_limit integer, p_after_user_id uuid) TO authenticated;


--
-- Name: FUNCTION loan_monthly_currency_summary(p_space_id uuid, p_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.loan_monthly_currency_summary(p_space_id uuid, p_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.loan_monthly_currency_summary(p_space_id uuid, p_month date) TO authenticated;


--
-- Name: FUNCTION loan_monthly_plan(p_space_id uuid, p_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.loan_monthly_plan(p_space_id uuid, p_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.loan_monthly_plan(p_space_id uuid, p_month date) TO authenticated;


--
-- Name: FUNCTION materialize_schedule_occurrences(p_space_id uuid, p_request_id uuid, p_from_date date, p_to_date date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.materialize_schedule_occurrences(p_space_id uuid, p_request_id uuid, p_from_date date, p_to_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.materialize_schedule_occurrences(p_space_id uuid, p_request_id uuid, p_from_date date, p_to_date date) TO authenticated;


--
-- Name: FUNCTION monthly_budget_category_page(p_space_id uuid, p_month date, p_after_created_at timestamp with time zone, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.monthly_budget_category_page(p_space_id uuid, p_month date, p_after_created_at timestamp with time zone, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.monthly_budget_category_page(p_space_id uuid, p_month date, p_after_created_at timestamp with time zone, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer) TO authenticated;


--
-- Name: FUNCTION monthly_budget_category_page_v2(p_space_id uuid, p_month date, p_after_created_at text, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.monthly_budget_category_page_v2(p_space_id uuid, p_month date, p_after_created_at text, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.monthly_budget_category_page_v2(p_space_id uuid, p_month date, p_after_created_at text, p_after_category_id uuid, p_after_currency public.currency_code, p_limit integer) TO authenticated;


--
-- Name: FUNCTION monthly_budget_category_page_v3(p_space_id uuid, p_month date, p_currency public.currency_code, p_after_created_at text, p_after_category_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.monthly_budget_category_page_v3(p_space_id uuid, p_month date, p_currency public.currency_code, p_after_created_at text, p_after_category_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.monthly_budget_category_page_v3(p_space_id uuid, p_month date, p_currency public.currency_code, p_after_created_at text, p_after_category_id uuid, p_limit integer) TO authenticated;


--
-- Name: FUNCTION monthly_budget_currency_summary(p_space_id uuid, p_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.monthly_budget_currency_summary(p_space_id uuid, p_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.monthly_budget_currency_summary(p_space_id uuid, p_month date) TO authenticated;


--
-- Name: FUNCTION move_goal_earmark(p_space_id uuid, p_request_id uuid, p_from_goal_id uuid, p_to_goal_id uuid, p_amount_minor text, p_expected_from_head text, p_expected_to_head text, p_accept_underfunded boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.move_goal_earmark(p_space_id uuid, p_request_id uuid, p_from_goal_id uuid, p_to_goal_id uuid, p_amount_minor text, p_expected_from_head text, p_expected_to_head text, p_accept_underfunded boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_goal_earmark(p_space_id uuid, p_request_id uuid, p_from_goal_id uuid, p_to_goal_id uuid, p_amount_minor text, p_expected_from_head text, p_expected_to_head text, p_accept_underfunded boolean) TO authenticated;


--
-- Name: FUNCTION open_loan_outstanding(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_amount_minor text, p_effective_date date, p_due_date date, p_note text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.open_loan_outstanding(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_amount_minor text, p_effective_date date, p_due_date date, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_loan_outstanding(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_amount_minor text, p_effective_date date, p_due_date date, p_note text) TO authenticated;


--
-- Name: FUNCTION preview_budget_month_close(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.preview_budget_month_close(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.preview_budget_month_close(p_space_id uuid, p_currency public.currency_code, p_month date, p_expected_close_id bigint) TO authenticated;


--
-- Name: FUNCTION preview_month_copy(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.preview_month_copy(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.preview_month_copy(p_space_id uuid, p_currency public.currency_code, p_source_snapshot_id bigint, p_target_month date) TO authenticated;


--
-- Name: FUNCTION publish_allocation_month(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.publish_allocation_month(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_allocation_month(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid) TO authenticated;


--
-- Name: FUNCTION publish_allocation_month_v2(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.publish_allocation_month_v2(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_allocation_month_v2(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_expected_snapshot_id bigint, p_template_revision_id bigint, p_expected_income_revision_id bigint, p_income_minor text, p_root_targets jsonb, p_loan_group_id uuid, p_goal_targets jsonb) TO authenticated;


--
-- Name: FUNCTION record_cash_loan(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_wallet_id uuid, p_amount_minor text, p_effective_date date, p_due_date date, p_note text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_cash_loan(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_wallet_id uuid, p_amount_minor text, p_effective_date date, p_due_date date, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_cash_loan(p_space_id uuid, p_request_id uuid, p_direction public.loan_direction, p_person_name text, p_currency public.currency_code, p_wallet_id uuid, p_amount_minor text, p_effective_date date, p_due_date date, p_note text) TO authenticated;


--
-- Name: FUNCTION record_categorized_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb, p_category_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_categorized_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb, p_category_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_categorized_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb, p_category_id uuid) TO authenticated;


--
-- Name: FUNCTION record_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_financial_event(p_space_id uuid, p_request_id uuid, p_kind public.financial_event_kind, p_effective_date date, p_movements jsonb) TO authenticated;


--
-- Name: FUNCTION record_goal_earmark(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_action text, p_amount_minor text, p_expected_head text, p_accept_underfunded boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_goal_earmark(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_action text, p_amount_minor text, p_expected_head text, p_accept_underfunded boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_goal_earmark(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_action text, p_amount_minor text, p_expected_head text, p_accept_underfunded boolean) TO authenticated;


--
-- Name: FUNCTION record_loan_repayment(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_wallet_id uuid, p_amount_minor text, p_effective_date date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_loan_repayment(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_wallet_id uuid, p_amount_minor text, p_effective_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_loan_repayment(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_wallet_id uuid, p_amount_minor text, p_effective_date date) TO authenticated;


--
-- Name: FUNCTION record_usd_to_lbp_exchange(p_space_id uuid, p_request_id uuid, p_usd_wallet_id uuid, p_lbp_wallet_id uuid, p_usd_amount_minor text, p_lbp_amount_minor text, p_effective_date date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.record_usd_to_lbp_exchange(p_space_id uuid, p_request_id uuid, p_usd_wallet_id uuid, p_lbp_wallet_id uuid, p_usd_amount_minor text, p_lbp_amount_minor text, p_effective_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_usd_to_lbp_exchange(p_space_id uuid, p_request_id uuid, p_usd_wallet_id uuid, p_lbp_wallet_id uuid, p_usd_amount_minor text, p_lbp_amount_minor text, p_effective_date date) TO authenticated;


--
-- Name: FUNCTION remove_household_member(p_space_id uuid, p_request_id uuid, p_member_user_id uuid); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.remove_household_member(p_space_id uuid, p_request_id uuid, p_member_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_household_member(p_space_id uuid, p_request_id uuid, p_member_user_id uuid) TO authenticated;


--
-- Name: FUNCTION rename_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid, p_name text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.rename_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rename_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid, p_name text) TO authenticated;


--
-- Name: FUNCTION report_category_actual_vs_budget(p_space_id uuid, p_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_category_actual_vs_budget(p_space_id uuid, p_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_category_actual_vs_budget(p_space_id uuid, p_month date) TO authenticated;


--
-- Name: FUNCTION report_monthly_cash_summary(p_space_id uuid, p_anchor_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_monthly_cash_summary(p_space_id uuid, p_anchor_month date) TO authenticated;


--
-- Name: FUNCTION report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid, p_currency public.currency_code, p_event_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid, p_currency public.currency_code, p_event_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_wallet_activity(p_space_id uuid, p_from_date date, p_to_date date, p_wallet_id uuid, p_currency public.currency_code, p_event_limit integer) TO authenticated;


--
-- Name: FUNCTION restore_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.restore_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restore_wallet(p_space_id uuid, p_request_id uuid, p_wallet_id uuid) TO authenticated;


--
-- Name: FUNCTION reverse_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_effective_date date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reverse_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_effective_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_financial_event(p_space_id uuid, p_request_id uuid, p_event_id uuid, p_effective_date date) TO authenticated;


--
-- Name: FUNCTION reverse_goal_earmark(p_space_id uuid, p_request_id uuid, p_event_id bigint, p_expected_heads jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reverse_goal_earmark(p_space_id uuid, p_request_id uuid, p_event_id bigint, p_expected_heads jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_goal_earmark(p_space_id uuid, p_request_id uuid, p_event_id bigint, p_expected_heads jsonb) TO authenticated;


--
-- Name: FUNCTION revise_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_expected_revision_id bigint, p_definition jsonb, p_milestones jsonb, p_state text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.revise_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_expected_revision_id bigint, p_definition jsonb, p_milestones jsonb, p_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revise_goal_plan(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_expected_revision_id bigint, p_definition jsonb, p_milestones jsonb, p_state text) TO authenticated;


--
-- Name: FUNCTION save_allocation_template(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.save_allocation_template(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_allocation_template(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_expected_revision_id bigint, p_groups jsonb, p_root_mappings jsonb) TO authenticated;


--
-- Name: FUNCTION save_schedule(p_space_id uuid, p_request_id uuid, p_schedule_id uuid, p_expected_revision_id bigint, p_definition jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.save_schedule(p_space_id uuid, p_request_id uuid, p_schedule_id uuid, p_expected_revision_id bigint, p_definition jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_schedule(p_space_id uuid, p_request_id uuid, p_schedule_id uuid, p_expected_revision_id bigint, p_definition jsonb) TO authenticated;


--
-- Name: FUNCTION scheduled_occurrence_page(p_space_id uuid, p_from_date date, p_to_date date, p_after_due_date date, p_after_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.scheduled_occurrence_page(p_space_id uuid, p_from_date date, p_to_date date, p_after_due_date date, p_after_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.scheduled_occurrence_page(p_space_id uuid, p_from_date date, p_to_date date, p_after_due_date date, p_after_id uuid, p_limit integer) TO authenticated;


--
-- Name: FUNCTION scheduled_overdue_page(p_space_id uuid, p_after_due_date date, p_after_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.scheduled_overdue_page(p_space_id uuid, p_after_due_date date, p_after_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.scheduled_overdue_page(p_space_id uuid, p_after_due_date date, p_after_id uuid, p_limit integer) TO authenticated;


--
-- Name: FUNCTION set_goal_milestone_state(p_space_id uuid, p_request_id uuid, p_milestone_id uuid, p_action text, p_expected_event_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_goal_milestone_state(p_space_id uuid, p_request_id uuid, p_milestone_id uuid, p_action text, p_expected_event_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_goal_milestone_state(p_space_id uuid, p_request_id uuid, p_milestone_id uuid, p_action text, p_expected_event_id bigint) TO authenticated;


--
-- Name: FUNCTION set_goal_monthly_target(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_month date, p_amount_minor text, p_expected_revision_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_goal_monthly_target(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_month date, p_amount_minor text, p_expected_revision_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_goal_monthly_target(p_space_id uuid, p_request_id uuid, p_goal_id uuid, p_month date, p_amount_minor text, p_expected_revision_id bigint) TO authenticated;


--
-- Name: FUNCTION set_household_member_role(p_space_id uuid, p_request_id uuid, p_member_user_id uuid, p_role public.member_role); Type: ACL; Schema: public; Owner: household_command_owner
--

REVOKE ALL ON FUNCTION public.set_household_member_role(p_space_id uuid, p_request_id uuid, p_member_user_id uuid, p_role public.member_role) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_household_member_role(p_space_id uuid, p_request_id uuid, p_member_user_id uuid, p_role public.member_role) TO authenticated;


--
-- Name: FUNCTION set_loan_monthly_target(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_month date, p_target_minor text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_loan_monthly_target(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_month date, p_target_minor text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_loan_monthly_target(p_space_id uuid, p_request_id uuid, p_loan_id uuid, p_month date, p_target_minor text) TO authenticated;


--
-- Name: FUNCTION set_monthly_category_target(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_monthly_category_target(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_monthly_category_target(p_space_id uuid, p_request_id uuid, p_category_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint) TO authenticated;


--
-- Name: FUNCTION set_monthly_income_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_monthly_income_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_monthly_income_plan(p_space_id uuid, p_request_id uuid, p_month date, p_currency public.currency_code, p_amount_minor text, p_expected_revision_id bigint) TO authenticated;


--
-- Name: FUNCTION set_occurrence_state(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_occurrence_state(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_occurrence_state(p_space_id uuid, p_request_id uuid, p_occurrence_id uuid, p_expected_event_id bigint, p_action text) TO authenticated;


--
-- Name: FUNCTION set_rollover_policy(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_root_id uuid, p_enabled boolean, p_expected_revision_id bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_rollover_policy(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_root_id uuid, p_enabled boolean, p_expected_revision_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_rollover_policy(p_space_id uuid, p_request_id uuid, p_currency public.currency_code, p_root_id uuid, p_enabled boolean, p_expected_revision_id bigint) TO authenticated;


--
-- Name: FUNCTION space_clock(p_space_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.space_clock(p_space_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.space_clock(p_space_id uuid) TO authenticated;


--
-- Name: FUNCTION space_period_bounds(p_space_id uuid, p_month date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.space_period_bounds(p_space_id uuid, p_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.space_period_bounds(p_space_id uuid, p_month date) TO authenticated;


--
-- Name: FUNCTION space_today(p_space_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.space_today(p_space_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.space_today(p_space_id uuid) TO authenticated;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.categories TO authenticated;


--
-- Name: TABLE financial_event_categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.financial_event_categories TO authenticated;


--
-- Name: TABLE financial_event_descriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.financial_event_descriptions TO authenticated;


--
-- Name: TABLE financial_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.financial_events TO authenticated;


--
-- Name: TABLE household_invitations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.household_invitations TO household_command_owner;


--
-- Name: TABLE household_membership_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.household_membership_events TO household_command_owner;


--
-- Name: TABLE loan_postings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.loan_postings TO authenticated;


--
-- Name: TABLE loans; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.loans TO authenticated;


--
-- Name: TABLE loan_balances; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.loan_balances TO authenticated;


--
-- Name: TABLE loan_monthly_target_revisions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.loan_monthly_target_revisions TO authenticated;


--
-- Name: TABLE payees; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.payees TO authenticated;


--
-- Name: TABLE space_memberships; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.space_memberships TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.space_memberships TO household_command_owner;


--
-- Name: TABLE spaces; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.spaces TO authenticated;
GRANT SELECT ON TABLE public.spaces TO household_command_owner;


--
-- Name: TABLE wallet_movements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.wallet_movements TO authenticated;


--
-- Name: TABLE wallet_balances; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.wallet_balances TO authenticated;


--
-- PostgreSQL database dump complete
--



alter function private.household_execute_invitation_creation(p_space_id uuid, p_request_id uuid, p_invitee_email text) owner to household_command_owner;
alter function private.household_execute_invitation_listing(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid) owner to household_command_owner;
alter function private.household_execute_member_listing(p_space_id uuid, p_limit integer, p_after_user_id uuid) owner to household_command_owner;
alter function public.accept_household_invitation(p_request_id uuid, p_invitation_token text) owner to household_command_owner;
alter function public.cancel_household_invitation(p_space_id uuid, p_request_id uuid, p_invitation_id uuid) owner to household_command_owner;
alter function public.create_household_invitation(p_space_id uuid, p_request_id uuid, p_invitee_email text) owner to household_command_owner;
alter function public.leave_household_space(p_space_id uuid, p_request_id uuid) owner to household_command_owner;
alter function public.list_household_invitations(p_space_id uuid, p_limit integer, p_after_created_at timestamp with time zone, p_after_id uuid) owner to household_command_owner;
alter function public.list_household_members(p_space_id uuid, p_limit integer, p_after_user_id uuid) owner to household_command_owner;
alter function public.remove_household_member(p_space_id uuid, p_request_id uuid, p_member_user_id uuid) owner to household_command_owner;
alter function public.set_household_member_role(p_space_id uuid, p_request_id uuid, p_member_user_id uuid, p_role public.member_role) owner to household_command_owner;

revoke create on schema public, private from household_command_owner;
-- The migration role only needed membership to transfer ownership; no login role may keep it.
revoke household_command_owner from postgres;
grant usage on schema public to household_command_owner;

-- Put the session settings the export changed back, so later migrations on this connection are unaffected.
select pg_catalog.set_config('search_path', '"$user", public, extensions', false);
reset statement_timeout; reset lock_timeout; reset idle_in_transaction_session_timeout; reset transaction_timeout;
reset check_function_bodies; reset row_security; reset client_min_messages; reset xmloption;
