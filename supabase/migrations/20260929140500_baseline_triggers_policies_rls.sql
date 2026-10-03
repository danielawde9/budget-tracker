-- Baseline part 7 of 9: triggers_policies_rls. Final schema exported from the original 61 migrations; apply in filename order to an empty database only.
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
-- Name: allocation_groups allocation_groups_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_groups_guard_insert BEFORE INSERT ON public.allocation_groups FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_groups allocation_groups_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_groups_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_groups FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_month_commitments allocation_month_commitments_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_commitments_guard_insert BEFORE INSERT ON public.allocation_month_commitments FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_month_commitments allocation_month_commitments_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_month_commitments_publish_check AFTER INSERT ON public.allocation_month_commitments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_month_from_commitment();


--
-- Name: allocation_month_commitments allocation_month_commitments_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_commitments_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_month_commitments FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_month_goal_lines allocation_month_goal_lines_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_goal_lines_guard_insert BEFORE INSERT ON public.allocation_month_goal_lines FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_month_goal_lines allocation_month_goal_lines_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_month_goal_lines_publish_check AFTER INSERT ON public.allocation_month_goal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_month_from_goal_line();


--
-- Name: allocation_month_goal_lines allocation_month_goal_lines_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_goal_lines_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_month_goal_lines FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_month_groups allocation_month_groups_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_groups_guard_insert BEFORE INSERT ON public.allocation_month_groups FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_month_groups allocation_month_groups_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_month_groups_publish_check AFTER INSERT ON public.allocation_month_groups DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_month_from_group();


--
-- Name: allocation_month_groups allocation_month_groups_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_groups_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_month_groups FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_month_roots allocation_month_roots_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_roots_guard_insert BEFORE INSERT ON public.allocation_month_roots FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_month_roots allocation_month_roots_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_month_roots_publish_check AFTER INSERT ON public.allocation_month_roots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_month_from_root();


--
-- Name: allocation_month_roots allocation_month_roots_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_roots_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_month_roots FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_month_snapshots allocation_month_snapshots_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_snapshots_guard_insert BEFORE INSERT ON public.allocation_month_snapshots FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_month_snapshots allocation_month_snapshots_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_month_snapshots_publish_check AFTER INSERT ON public.allocation_month_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_month_from_header();


--
-- Name: allocation_month_snapshots allocation_month_snapshots_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_month_snapshots_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_month_snapshots FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_template_lines allocation_template_lines_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_template_lines_guard_insert BEFORE INSERT ON public.allocation_template_lines FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_template_lines allocation_template_lines_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_template_lines_publish_check AFTER INSERT ON public.allocation_template_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_template_from_line();


--
-- Name: allocation_template_lines allocation_template_lines_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_template_lines_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_template_lines FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_template_revisions allocation_template_revisions_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_template_revisions_guard_insert BEFORE INSERT ON public.allocation_template_revisions FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_template_revisions allocation_template_revisions_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_template_revisions_publish_check AFTER INSERT ON public.allocation_template_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_template_from_header();


--
-- Name: allocation_template_revisions allocation_template_revisions_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_template_revisions_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_template_revisions FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: allocation_template_roots allocation_template_roots_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_template_roots_guard_insert BEFORE INSERT ON public.allocation_template_roots FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: allocation_template_roots allocation_template_roots_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER allocation_template_roots_publish_check AFTER INSERT ON public.allocation_template_roots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_allocation_template_from_root();


--
-- Name: allocation_template_roots allocation_template_roots_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER allocation_template_roots_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.allocation_template_roots FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: budget_month_carry_links budget_month_carry_links_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER budget_month_carry_links_guard_insert BEFORE INSERT ON public.budget_month_carry_links FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: budget_month_carry_links budget_month_carry_links_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER budget_month_carry_links_publish_check AFTER INSERT ON public.budget_month_carry_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_budget_month_carry_from_link();


--
-- Name: budget_month_carry_links budget_month_carry_links_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER budget_month_carry_links_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.budget_month_carry_links FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: budget_month_close_roots budget_month_close_roots_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER budget_month_close_roots_guard_insert BEFORE INSERT ON public.budget_month_close_roots FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: budget_month_close_roots budget_month_close_roots_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER budget_month_close_roots_publish_check AFTER INSERT ON public.budget_month_close_roots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_budget_month_close_from_root();


--
-- Name: budget_month_close_roots budget_month_close_roots_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER budget_month_close_roots_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.budget_month_close_roots FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: budget_month_closes budget_month_closes_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER budget_month_closes_guard_insert BEFORE INSERT ON public.budget_month_closes FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: budget_month_closes budget_month_closes_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER budget_month_closes_publish_check AFTER INSERT ON public.budget_month_closes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_budget_month_close_from_header();


--
-- Name: budget_month_closes budget_month_closes_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER budget_month_closes_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.budget_month_closes FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: categories categories_guard_archive_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER categories_guard_archive_update BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION private.guard_category_archive_transition();


--
-- Name: categories categories_reject_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER categories_reject_delete BEFORE DELETE ON public.categories FOR EACH ROW EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: categories categories_reject_delete_statement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER categories_reject_delete_statement BEFORE DELETE ON public.categories FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: categories categories_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER categories_reject_truncate BEFORE TRUNCATE ON public.categories FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: categories categories_require_owner_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER categories_require_owner_insert BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write();


--
-- Name: categories categories_validate_parent_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER categories_validate_parent_insert BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION private.validate_category_parent();


--
-- Name: category_command_requests category_command_requests_reject_delete_statement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER category_command_requests_reject_delete_statement BEFORE DELETE ON public.category_command_requests FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: category_command_requests category_command_requests_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER category_command_requests_reject_row_mutation BEFORE DELETE OR UPDATE ON public.category_command_requests FOR EACH ROW EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: category_command_requests category_command_requests_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER category_command_requests_reject_truncate BEFORE TRUNCATE ON public.category_command_requests FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: category_command_requests category_command_requests_require_owner_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER category_command_requests_require_owner_insert BEFORE INSERT ON public.category_command_requests FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write();


--
-- Name: financial_event_categories financial_event_categories_reject_delete_statement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_categories_reject_delete_statement BEFORE DELETE ON public.financial_event_categories FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: financial_event_categories financial_event_categories_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_categories_reject_row_mutation BEFORE DELETE OR UPDATE ON public.financial_event_categories FOR EACH ROW EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: financial_event_categories financial_event_categories_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_categories_reject_truncate BEFORE TRUNCATE ON public.financial_event_categories FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: financial_event_categories financial_event_categories_require_owner_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_categories_require_owner_insert BEFORE INSERT ON public.financial_event_categories FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write();


--
-- Name: financial_event_categories financial_event_categories_validate_reversal; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_categories_validate_reversal BEFORE INSERT ON public.financial_event_categories FOR EACH ROW EXECUTE FUNCTION private.validate_reversal_category_copy();


--
-- Name: financial_event_description_requests financial_event_description_requests_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_description_requests_reject_row_mutation BEFORE DELETE OR UPDATE ON public.financial_event_description_requests FOR EACH ROW EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: financial_event_description_requests financial_event_description_requests_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_description_requests_reject_truncate BEFORE TRUNCATE ON public.financial_event_description_requests FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: financial_event_description_requests financial_event_description_requests_require_owner_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_description_requests_require_owner_insert BEFORE INSERT ON public.financial_event_description_requests FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write();


--
-- Name: financial_event_descriptions financial_event_descriptions_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_descriptions_reject_row_mutation BEFORE DELETE OR UPDATE ON public.financial_event_descriptions FOR EACH ROW EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: financial_event_descriptions financial_event_descriptions_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_descriptions_reject_truncate BEFORE TRUNCATE ON public.financial_event_descriptions FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: financial_event_descriptions financial_event_descriptions_require_owner_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_event_descriptions_require_owner_insert BEFORE INSERT ON public.financial_event_descriptions FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write();


--
-- Name: financial_events financial_events_reject_history_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_events_reject_history_row_mutation BEFORE DELETE OR UPDATE ON public.financial_events FOR EACH ROW EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: financial_events financial_events_reject_history_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_events_reject_history_truncate BEFORE TRUNCATE ON public.financial_events FOR EACH STATEMENT EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: financial_events financial_events_reversal_date_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER financial_events_reversal_date_guard BEFORE INSERT ON public.financial_events FOR EACH ROW WHEN ((new.reversal_of IS NOT NULL)) EXECUTE FUNCTION private.reject_reversal_before_original();


--
-- Name: goal_earmark_events goal_earmark_events_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_earmark_events_guard_insert BEFORE INSERT ON public.goal_earmark_events FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_earmark_events goal_earmark_events_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER goal_earmark_events_publish_check AFTER INSERT ON public.goal_earmark_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_goal_earmark_event_from_header();


--
-- Name: goal_earmark_events goal_earmark_events_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_earmark_events_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_earmark_events FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goal_earmark_lines goal_earmark_lines_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_earmark_lines_guard_insert BEFORE INSERT ON public.goal_earmark_lines FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_earmark_lines goal_earmark_lines_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER goal_earmark_lines_publish_check AFTER INSERT ON public.goal_earmark_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_goal_earmark_event_from_line();


--
-- Name: goal_earmark_lines goal_earmark_lines_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_earmark_lines_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_earmark_lines FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goal_milestone_events goal_milestone_events_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_milestone_events_guard_insert BEFORE INSERT ON public.goal_milestone_events FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_milestone_events goal_milestone_events_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER goal_milestone_events_publish_check AFTER INSERT ON public.goal_milestone_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_goal_milestone_event_from_event();


--
-- Name: goal_milestone_events goal_milestone_events_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_milestone_events_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_milestone_events FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goal_milestones goal_milestones_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_milestones_guard_insert BEFORE INSERT ON public.goal_milestones FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_milestones goal_milestones_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_milestones_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_milestones FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_monthly_target_revisions_guard_insert BEFORE INSERT ON public.goal_monthly_target_revisions FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_monthly_target_revisions_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_monthly_target_revisions FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goal_purchase_links goal_purchase_links_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_purchase_links_guard_insert BEFORE INSERT ON public.goal_purchase_links FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_purchase_links goal_purchase_links_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_purchase_links_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_purchase_links FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goal_revision_milestones goal_revision_milestones_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_revision_milestones_guard_insert BEFORE INSERT ON public.goal_revision_milestones FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_revision_milestones goal_revision_milestones_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER goal_revision_milestones_publish_check AFTER INSERT ON public.goal_revision_milestones DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_goal_definition_from_milestone();


--
-- Name: goal_revision_milestones goal_revision_milestones_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_revision_milestones_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_revision_milestones FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goal_revisions goal_revisions_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_revisions_guard_insert BEFORE INSERT ON public.goal_revisions FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goal_revisions goal_revisions_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER goal_revisions_publish_check AFTER INSERT ON public.goal_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_goal_definition_from_header();


--
-- Name: goal_revisions goal_revisions_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goal_revisions_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goal_revisions FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: goals goals_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goals_guard_insert BEFORE INSERT ON public.goals FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: goals goals_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER goals_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.goals FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: household_invitations household_invitations_require_household_space; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER household_invitations_require_household_space AFTER INSERT OR UPDATE OF space_id ON public.household_invitations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.enforce_household_invitation_space();


--
-- Name: household_membership_events household_membership_events_reject_delete_statement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER household_membership_events_reject_delete_statement BEFORE DELETE ON public.household_membership_events FOR EACH STATEMENT EXECUTE FUNCTION private.reject_household_membership_event_mutation();


--
-- Name: household_membership_events household_membership_events_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER household_membership_events_reject_row_mutation BEFORE DELETE OR UPDATE ON public.household_membership_events FOR EACH ROW EXECUTE FUNCTION private.reject_household_membership_event_mutation();


--
-- Name: household_membership_events household_membership_events_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER household_membership_events_reject_truncate BEFORE TRUNCATE ON public.household_membership_events FOR EACH STATEMENT EXECUTE FUNCTION private.reject_household_membership_event_mutation();


--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_reject_history_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER loan_monthly_target_revisions_reject_history_row_mutation BEFORE DELETE OR UPDATE ON public.loan_monthly_target_revisions FOR EACH ROW EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_reject_history_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER loan_monthly_target_revisions_reject_history_truncate BEFORE TRUNCATE ON public.loan_monthly_target_revisions FOR EACH STATEMENT EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: loan_postings loan_postings_reject_history_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER loan_postings_reject_history_row_mutation BEFORE DELETE OR UPDATE ON public.loan_postings FOR EACH ROW EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: loan_postings loan_postings_reject_history_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER loan_postings_reject_history_truncate BEFORE TRUNCATE ON public.loan_postings FOR EACH STATEMENT EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: loans loans_reject_history_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER loans_reject_history_row_mutation BEFORE DELETE OR UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: loans loans_reject_history_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER loans_reject_history_truncate BEFORE TRUNCATE ON public.loans FOR EACH STATEMENT EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER monthly_budget_plan_revisions_reject_row_mutation BEFORE DELETE OR UPDATE ON public.monthly_budget_plan_revisions FOR EACH ROW EXECUTE FUNCTION private.reject_monthly_budget_plan_mutation();


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_reject_subcategory_target; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER monthly_budget_plan_revisions_reject_subcategory_target BEFORE INSERT ON public.monthly_budget_plan_revisions FOR EACH ROW EXECUTE FUNCTION private.reject_subcategory_budget_target();


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER monthly_budget_plan_revisions_reject_truncate BEFORE TRUNCATE ON public.monthly_budget_plan_revisions FOR EACH STATEMENT EXECUTE FUNCTION private.reject_monthly_budget_plan_mutation();


--
-- Name: occurrence_events occurrence_events_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER occurrence_events_guard_insert BEFORE INSERT ON public.occurrence_events FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: occurrence_events occurrence_events_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER occurrence_events_publish_check AFTER INSERT ON public.occurrence_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_occurrence_event_from_row();


--
-- Name: occurrence_events occurrence_events_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER occurrence_events_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.occurrence_events FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: payees payees_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payees_reject_row_mutation BEFORE DELETE OR UPDATE ON public.payees FOR EACH ROW EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: payees payees_reject_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payees_reject_truncate BEFORE TRUNCATE ON public.payees FOR EACH STATEMENT EXECUTE FUNCTION private.reject_category_history_mutation();


--
-- Name: payees payees_require_owner_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER payees_require_owner_insert BEFORE INSERT ON public.payees FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write();


--
-- Name: planning_command_receipts planning_command_receipts_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER planning_command_receipts_guard_insert BEFORE INSERT ON public.planning_command_receipts FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: planning_command_receipts planning_command_receipts_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER planning_command_receipts_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.planning_command_receipts FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: rollover_policy_revisions rollover_policy_revisions_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER rollover_policy_revisions_guard_insert BEFORE INSERT ON public.rollover_policy_revisions FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: rollover_policy_revisions rollover_policy_revisions_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER rollover_policy_revisions_publish_check AFTER INSERT ON public.rollover_policy_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_rollover_policy_from_row();


--
-- Name: rollover_policy_revisions rollover_policy_revisions_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER rollover_policy_revisions_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.rollover_policy_revisions FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: schedule_revisions schedule_revisions_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER schedule_revisions_guard_insert BEFORE INSERT ON public.schedule_revisions FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: schedule_revisions schedule_revisions_publish_check; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER schedule_revisions_publish_check AFTER INSERT ON public.schedule_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_schedule_revision_from_header();


--
-- Name: schedule_revisions schedule_revisions_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER schedule_revisions_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.schedule_revisions FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: scheduled_occurrences scheduled_occurrences_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER scheduled_occurrences_guard_insert BEFORE INSERT ON public.scheduled_occurrences FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: scheduled_occurrences scheduled_occurrences_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER scheduled_occurrences_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.scheduled_occurrences FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: schedules schedules_guard_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER schedules_guard_insert BEFORE INSERT ON public.schedules FOR EACH ROW EXECUTE FUNCTION private.planning_guard_insert();


--
-- Name: schedules schedules_reject_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER schedules_reject_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.schedules FOR EACH STATEMENT EXECUTE FUNCTION private.planning_reject_mutation();


--
-- Name: space_memberships space_memberships_preserve_space_owners; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER space_memberships_preserve_space_owners AFTER INSERT OR DELETE OR UPDATE ON public.space_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.enforce_space_membership_invariant();


--
-- Name: spaces spaces_preserve_membership_invariants; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER spaces_preserve_membership_invariants AFTER INSERT OR UPDATE OF kind ON public.spaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.enforce_space_row_membership_invariant();


--
-- Name: spaces spaces_timezone_valid; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER spaces_timezone_valid BEFORE INSERT OR UPDATE OF timezone ON public.spaces FOR EACH ROW EXECUTE FUNCTION private.validate_space_timezone();


--
-- Name: wallet_command_requests wallet_command_requests_reject_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallet_command_requests_reject_row_mutation BEFORE DELETE OR UPDATE ON public.wallet_command_requests FOR EACH ROW EXECUTE FUNCTION private.reject_wallet_command_history_mutation();


--
-- Name: wallet_command_requests wallet_command_requests_reject_statement_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallet_command_requests_reject_statement_mutation BEFORE DELETE OR TRUNCATE ON public.wallet_command_requests FOR EACH STATEMENT EXECUTE FUNCTION private.reject_wallet_command_history_mutation();


--
-- Name: wallet_command_requests wallet_command_requests_require_owner_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallet_command_requests_require_owner_insert BEFORE INSERT ON public.wallet_command_requests FOR EACH ROW EXECUTE FUNCTION private.require_table_owner_write();


--
-- Name: wallet_movements wallet_movements_reject_history_row_mutation; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallet_movements_reject_history_row_mutation BEFORE DELETE OR UPDATE ON public.wallet_movements FOR EACH ROW EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: wallet_movements wallet_movements_reject_history_truncate; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallet_movements_reject_history_truncate BEFORE TRUNCATE ON public.wallet_movements FOR EACH STATEMENT EXECUTE FUNCTION private.reject_posted_history_mutation();


--
-- Name: wallet_movements wallet_movements_require_active_wallet; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallet_movements_require_active_wallet BEFORE INSERT ON public.wallet_movements FOR EACH ROW EXECUTE FUNCTION private.require_active_movement_wallet();


--
-- Name: wallets wallets_guard_update; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallets_guard_update BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION private.guard_wallet_update();


--
-- Name: wallets wallets_reject_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallets_reject_delete BEFORE DELETE ON public.wallets FOR EACH ROW EXECUTE FUNCTION private.reject_wallet_deletion();


--
-- Name: wallets wallets_reject_delete_statement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER wallets_reject_delete_statement BEFORE DELETE OR TRUNCATE ON public.wallets FOR EACH STATEMENT EXECUTE FUNCTION private.reject_wallet_deletion();


--
-- Name: allocation_groups; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_month_commitments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_month_commitments ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_month_goal_lines; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_month_goal_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_month_groups; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_month_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_month_roots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_month_roots ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_month_snapshots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_month_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_template_lines; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_template_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_template_revisions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_template_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: allocation_template_roots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.allocation_template_roots ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_month_carry_links; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.budget_month_carry_links ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_month_close_roots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.budget_month_close_roots ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_month_closes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.budget_month_closes ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY categories_read_for_members ON public.categories FOR SELECT TO authenticated USING (( SELECT private.is_active_member(categories.space_id) AS is_active_member));


--
-- Name: category_command_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.category_command_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_event_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.financial_event_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_event_categories financial_event_categories_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY financial_event_categories_read_for_members ON public.financial_event_categories FOR SELECT TO authenticated USING (( SELECT private.is_active_member(financial_event_categories.space_id) AS is_active_member));


--
-- Name: financial_event_description_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.financial_event_description_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_event_descriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.financial_event_descriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_event_descriptions financial_event_descriptions_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY financial_event_descriptions_read_for_members ON public.financial_event_descriptions FOR SELECT TO authenticated USING (( SELECT private.is_active_member(financial_event_descriptions.space_id) AS is_active_member));


--
-- Name: financial_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.financial_events ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_events financial_events_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY financial_events_read_for_members ON public.financial_events FOR SELECT TO authenticated USING (( SELECT private.is_active_member(financial_events.space_id) AS is_active_member));


--
-- Name: goal_earmark_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_earmark_events ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_earmark_lines; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_earmark_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_milestone_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_milestone_events ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_milestones; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_milestones ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_monthly_target_revisions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_monthly_target_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_purchase_links; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_purchase_links ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_revision_milestones; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_revision_milestones ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_revisions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goal_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: goals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

--
-- Name: household_invitations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.household_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: household_invitations household_invitations_command_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY household_invitations_command_owner ON public.household_invitations TO household_command_owner USING (true) WITH CHECK (true);


--
-- Name: household_membership_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.household_membership_events ENABLE ROW LEVEL SECURITY;

--
-- Name: household_membership_events household_membership_events_command_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY household_membership_events_command_owner ON public.household_membership_events TO household_command_owner USING (true) WITH CHECK (true);


--
-- Name: loan_monthly_target_revisions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.loan_monthly_target_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY loan_monthly_target_revisions_read_for_members ON public.loan_monthly_target_revisions FOR SELECT TO authenticated USING (( SELECT private.is_active_member(loan_monthly_target_revisions.space_id) AS is_active_member));


--
-- Name: loan_postings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.loan_postings ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_postings loan_postings_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY loan_postings_read_for_members ON public.loan_postings FOR SELECT TO authenticated USING (( SELECT private.is_active_member(loan_postings.space_id) AS is_active_member));


--
-- Name: loans; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

--
-- Name: loans loans_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY loans_read_for_members ON public.loans FOR SELECT TO authenticated USING (( SELECT private.is_active_member(loans.space_id) AS is_active_member));


--
-- Name: space_memberships memberships_read_for_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY memberships_read_for_self ON public.space_memberships FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: monthly_budget_plan_revisions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.monthly_budget_plan_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: occurrence_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.occurrence_events ENABLE ROW LEVEL SECURITY;

--
-- Name: payees; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.payees ENABLE ROW LEVEL SECURITY;

--
-- Name: payees payees_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY payees_read_for_members ON public.payees FOR SELECT TO authenticated USING (( SELECT private.is_active_member(payees.space_id) AS is_active_member));


--
-- Name: planning_command_receipts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.planning_command_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: rollover_policy_revisions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rollover_policy_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_revisions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.schedule_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: scheduled_occurrences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.scheduled_occurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: schedules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: space_memberships; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.space_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: space_memberships space_memberships_household_command_owner; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY space_memberships_household_command_owner ON public.space_memberships TO household_command_owner USING (true) WITH CHECK (true);


--
-- Name: spaces; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: spaces spaces_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY spaces_read_for_members ON public.spaces FOR SELECT TO authenticated USING (( SELECT private.is_active_member(spaces.id) AS is_active_member));


--
-- Name: wallet_command_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wallet_command_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_movements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wallet_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_movements wallet_movements_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY wallet_movements_read_for_members ON public.wallet_movements FOR SELECT TO authenticated USING (( SELECT private.is_active_member(wallet_movements.space_id) AS is_active_member));


--
-- Name: wallets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets wallets_read_for_members; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY wallets_read_for_members ON public.wallets FOR SELECT TO authenticated USING (( SELECT private.is_active_member(wallets.space_id) AS is_active_member));


--
-- PostgreSQL database dump complete
--



-- Put the session settings the export changed back, so later migrations on this connection are unaffected.
select pg_catalog.set_config('search_path', '"$user", public, extensions', false);
reset statement_timeout; reset lock_timeout; reset idle_in_transaction_session_timeout; reset transaction_timeout;
reset check_function_bodies; reset row_security; reset client_min_messages; reset xmloption;
