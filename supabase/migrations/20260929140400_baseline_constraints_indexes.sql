-- Baseline part 6 of 9: constraints_indexes. Final schema exported from the original 61 migrations; apply in filename order to an empty database only.
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

SET default_tablespace = '';

--
-- Name: household_invitation_keys household_invitation_keys_pkey; Type: CONSTRAINT; Schema: private; Owner: postgres
--

ALTER TABLE ONLY private.household_invitation_keys
    ADD CONSTRAINT household_invitation_keys_pkey PRIMARY KEY (key_version);


--
-- Name: allocation_groups allocation_groups_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_groups
    ADD CONSTRAINT allocation_groups_id_space_id_currency_key UNIQUE (id, space_id, currency);


--
-- Name: allocation_groups allocation_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_groups
    ADD CONSTRAINT allocation_groups_pkey PRIMARY KEY (id);


--
-- Name: allocation_month_commitments allocation_month_commitments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_commitments
    ADD CONSTRAINT allocation_month_commitments_pkey PRIMARY KEY (snapshot_id);


--
-- Name: allocation_month_goal_lines allocation_month_goal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_goal_lines
    ADD CONSTRAINT allocation_month_goal_lines_pkey PRIMARY KEY (snapshot_id, goal_id);


--
-- Name: allocation_month_groups allocation_month_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_groups
    ADD CONSTRAINT allocation_month_groups_pkey PRIMARY KEY (snapshot_id, group_id);


--
-- Name: allocation_month_groups allocation_month_groups_snapshot_id_display_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_groups
    ADD CONSTRAINT allocation_month_groups_snapshot_id_display_order_key UNIQUE (snapshot_id, display_order);


--
-- Name: allocation_month_groups allocation_month_groups_snapshot_id_group_id_space_id_curre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_groups
    ADD CONSTRAINT allocation_month_groups_snapshot_id_group_id_space_id_curre_key UNIQUE (snapshot_id, group_id, space_id, currency);


--
-- Name: allocation_month_roots allocation_month_roots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_roots
    ADD CONSTRAINT allocation_month_roots_pkey PRIMARY KEY (snapshot_id, category_id);


--
-- Name: allocation_month_roots allocation_month_roots_target_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_roots
    ADD CONSTRAINT allocation_month_roots_target_key UNIQUE (snapshot_id, category_id, target_minor);


--
-- Name: allocation_month_snapshots allocation_month_snapshots_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_id_space_id_currency_key UNIQUE (id, space_id, currency);


--
-- Name: allocation_month_snapshots allocation_month_snapshots_id_space_id_currency_month_start_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_id_space_id_currency_month_start_key UNIQUE (id, space_id, currency, month_start);


--
-- Name: allocation_month_snapshots allocation_month_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_pkey PRIMARY KEY (id);


--
-- Name: allocation_month_snapshots allocation_month_snapshots_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: allocation_template_lines allocation_template_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_lines
    ADD CONSTRAINT allocation_template_lines_pkey PRIMARY KEY (template_id, group_id);


--
-- Name: allocation_template_lines allocation_template_lines_template_id_display_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_lines
    ADD CONSTRAINT allocation_template_lines_template_id_display_order_key UNIQUE (template_id, display_order);


--
-- Name: allocation_template_lines allocation_template_lines_template_id_group_id_space_id_cur_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_lines
    ADD CONSTRAINT allocation_template_lines_template_id_group_id_space_id_cur_key UNIQUE (template_id, group_id, space_id, currency);


--
-- Name: allocation_template_revisions allocation_template_revisions_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_revisions
    ADD CONSTRAINT allocation_template_revisions_id_space_id_currency_key UNIQUE (id, space_id, currency);


--
-- Name: allocation_template_revisions allocation_template_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_revisions
    ADD CONSTRAINT allocation_template_revisions_pkey PRIMARY KEY (id);


--
-- Name: allocation_template_revisions allocation_template_revisions_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_revisions
    ADD CONSTRAINT allocation_template_revisions_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: allocation_template_roots allocation_template_roots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_roots
    ADD CONSTRAINT allocation_template_roots_pkey PRIMARY KEY (template_id, category_id);


--
-- Name: budget_month_carry_links budget_month_carry_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_carry_links
    ADD CONSTRAINT budget_month_carry_links_pkey PRIMARY KEY (id);


--
-- Name: budget_month_carry_links budget_month_carry_links_target_snapshot_id_root_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_carry_links
    ADD CONSTRAINT budget_month_carry_links_target_snapshot_id_root_id_key UNIQUE (target_snapshot_id, root_id);


--
-- Name: budget_month_close_roots budget_month_close_roots_close_id_root_id_outgoing_carry_mi_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_close_roots
    ADD CONSTRAINT budget_month_close_roots_close_id_root_id_outgoing_carry_mi_key UNIQUE (close_id, root_id, outgoing_carry_minor, enabled);


--
-- Name: budget_month_close_roots budget_month_close_roots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_close_roots
    ADD CONSTRAINT budget_month_close_roots_pkey PRIMARY KEY (close_id, root_id);


--
-- Name: budget_month_closes budget_month_closes_id_space_id_currency_month_start_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_id_space_id_currency_month_start_key UNIQUE (id, space_id, currency, month_start);


--
-- Name: budget_month_closes budget_month_closes_id_space_id_currency_month_start_source_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_id_space_id_currency_month_start_source_key UNIQUE (id, space_id, currency, month_start, source_snapshot_id);


--
-- Name: budget_month_closes budget_month_closes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_pkey PRIMARY KEY (id);


--
-- Name: budget_month_closes budget_month_closes_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: categories categories_id_space_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_id_space_key UNIQUE (id, space_id);


--
-- Name: categories categories_id_space_kind_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_id_space_kind_key UNIQUE (id, space_id, kind);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: category_command_requests category_command_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_command_requests
    ADD CONSTRAINT category_command_requests_pkey PRIMARY KEY (space_id, request_id);


--
-- Name: financial_event_categories financial_event_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_categories
    ADD CONSTRAINT financial_event_categories_pkey PRIMARY KEY (event_id);


--
-- Name: financial_event_description_requests financial_event_description_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_description_requests
    ADD CONSTRAINT financial_event_description_requests_pkey PRIMARY KEY (space_id, request_id);


--
-- Name: financial_event_descriptions financial_event_descriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_descriptions
    ADD CONSTRAINT financial_event_descriptions_pkey PRIMARY KEY (event_id);


--
-- Name: financial_events financial_events_id_space_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_events
    ADD CONSTRAINT financial_events_id_space_id_key UNIQUE (id, space_id);


--
-- Name: financial_events financial_events_id_space_kind_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_events
    ADD CONSTRAINT financial_events_id_space_kind_key UNIQUE (id, space_id, kind);


--
-- Name: financial_events financial_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_events
    ADD CONSTRAINT financial_events_pkey PRIMARY KEY (id);


--
-- Name: financial_events financial_events_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_events
    ADD CONSTRAINT financial_events_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: goal_earmark_events goal_earmark_events_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_events
    ADD CONSTRAINT goal_earmark_events_id_space_id_currency_key UNIQUE (id, space_id, currency);


--
-- Name: goal_earmark_events goal_earmark_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_events
    ADD CONSTRAINT goal_earmark_events_pkey PRIMARY KEY (id);


--
-- Name: goal_earmark_events goal_earmark_events_reversal_of_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_events
    ADD CONSTRAINT goal_earmark_events_reversal_of_key UNIQUE (reversal_of);


--
-- Name: goal_earmark_events goal_earmark_events_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_events
    ADD CONSTRAINT goal_earmark_events_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: goal_earmark_lines goal_earmark_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_lines
    ADD CONSTRAINT goal_earmark_lines_pkey PRIMARY KEY (event_id, goal_id);


--
-- Name: goal_milestone_events goal_milestone_events_id_milestone_id_space_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestone_events
    ADD CONSTRAINT goal_milestone_events_id_milestone_id_space_id_key UNIQUE (id, milestone_id, space_id);


--
-- Name: goal_milestone_events goal_milestone_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestone_events
    ADD CONSTRAINT goal_milestone_events_pkey PRIMARY KEY (id);


--
-- Name: goal_milestone_events goal_milestone_events_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestone_events
    ADD CONSTRAINT goal_milestone_events_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: goal_milestones goal_milestones_id_goal_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestones
    ADD CONSTRAINT goal_milestones_id_goal_id_space_id_currency_key UNIQUE (id, goal_id, space_id, currency);


--
-- Name: goal_milestones goal_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestones
    ADD CONSTRAINT goal_milestones_pkey PRIMARY KEY (id);


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_id_goal_id_space_id_currency__key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_monthly_target_revisions
    ADD CONSTRAINT goal_monthly_target_revisions_id_goal_id_space_id_currency__key UNIQUE (id, goal_id, space_id, currency, month_start);


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_monthly_target_revisions
    ADD CONSTRAINT goal_monthly_target_revisions_pkey PRIMARY KEY (id);


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_monthly_target_revisions
    ADD CONSTRAINT goal_monthly_target_revisions_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: goal_purchase_links goal_purchase_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_purchase_links
    ADD CONSTRAINT goal_purchase_links_pkey PRIMARY KEY (id);


--
-- Name: goal_purchase_links goal_purchase_links_space_id_request_id_goal_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_purchase_links
    ADD CONSTRAINT goal_purchase_links_space_id_request_id_goal_id_key UNIQUE (space_id, request_id, goal_id);


--
-- Name: goal_revision_milestones goal_revision_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revision_milestones
    ADD CONSTRAINT goal_revision_milestones_pkey PRIMARY KEY (revision_id, milestone_id);


--
-- Name: goal_revision_milestones goal_revision_milestones_revision_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revision_milestones
    ADD CONSTRAINT goal_revision_milestones_revision_id_ordinal_key UNIQUE (revision_id, ordinal);


--
-- Name: goal_revisions goal_revisions_id_goal_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revisions
    ADD CONSTRAINT goal_revisions_id_goal_id_space_id_currency_key UNIQUE (id, goal_id, space_id, currency);


--
-- Name: goal_revisions goal_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revisions
    ADD CONSTRAINT goal_revisions_pkey PRIMARY KEY (id);


--
-- Name: goal_revisions goal_revisions_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revisions
    ADD CONSTRAINT goal_revisions_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: goals goals_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_id_space_id_currency_key UNIQUE (id, space_id, currency);


--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);


--
-- Name: household_invitations household_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_invitations
    ADD CONSTRAINT household_invitations_pkey PRIMARY KEY (id);


--
-- Name: household_invitations household_invitations_token_digest_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_invitations
    ADD CONSTRAINT household_invitations_token_digest_key UNIQUE (token_digest);


--
-- Name: household_membership_events household_membership_events_actor_request_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_membership_events
    ADD CONSTRAINT household_membership_events_actor_request_key UNIQUE (actor_user_id, request_id);


--
-- Name: household_membership_events household_membership_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_membership_events
    ADD CONSTRAINT household_membership_events_pkey PRIMARY KEY (id);


--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_monthly_target_revisions
    ADD CONSTRAINT loan_monthly_target_revisions_pkey PRIMARY KEY (id);


--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_monthly_target_revisions
    ADD CONSTRAINT loan_monthly_target_revisions_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: loan_postings loan_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_postings
    ADD CONSTRAINT loan_postings_pkey PRIMARY KEY (event_id);


--
-- Name: loans loans_id_space_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_id_space_id_key UNIQUE (id, space_id);


--
-- Name: loans loans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_pkey PRIMARY KEY (id);


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.monthly_budget_plan_revisions
    ADD CONSTRAINT monthly_budget_plan_revisions_pkey PRIMARY KEY (id);


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.monthly_budget_plan_revisions
    ADD CONSTRAINT monthly_budget_plan_revisions_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: monthly_budget_plan_revisions monthly_budget_revision_space_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.monthly_budget_plan_revisions
    ADD CONSTRAINT monthly_budget_revision_space_key UNIQUE (id, space_id);


--
-- Name: occurrence_events occurrence_events_id_occurrence_id_space_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.occurrence_events
    ADD CONSTRAINT occurrence_events_id_occurrence_id_space_id_key UNIQUE (id, occurrence_id, space_id);


--
-- Name: occurrence_events occurrence_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.occurrence_events
    ADD CONSTRAINT occurrence_events_pkey PRIMARY KEY (id);


--
-- Name: occurrence_events occurrence_events_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.occurrence_events
    ADD CONSTRAINT occurrence_events_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: payees payees_id_space_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payees
    ADD CONSTRAINT payees_id_space_key UNIQUE (id, space_id);


--
-- Name: payees payees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payees
    ADD CONSTRAINT payees_pkey PRIMARY KEY (id);


--
-- Name: payees payees_space_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payees
    ADD CONSTRAINT payees_space_name_key UNIQUE (space_id, name_key);


--
-- Name: planning_command_receipts planning_command_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planning_command_receipts
    ADD CONSTRAINT planning_command_receipts_pkey PRIMARY KEY (space_id, request_id);


--
-- Name: planning_command_receipts planning_command_receipts_sequence_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planning_command_receipts
    ADD CONSTRAINT planning_command_receipts_sequence_id_key UNIQUE (sequence_id);


--
-- Name: rollover_policy_revisions rollover_policy_revisions_id_space_id_currency_root_id_enab_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_id_space_id_currency_root_id_enab_key UNIQUE (id, space_id, currency, root_id, enabled);


--
-- Name: rollover_policy_revisions rollover_policy_revisions_id_space_id_currency_root_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_id_space_id_currency_root_id_key UNIQUE (id, space_id, currency, root_id);


--
-- Name: rollover_policy_revisions rollover_policy_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_pkey PRIMARY KEY (id);


--
-- Name: rollover_policy_revisions rollover_policy_revisions_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: schedule_revisions schedule_revisions_id_schedule_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_id_schedule_id_space_id_currency_key UNIQUE (id, schedule_id, space_id, currency);


--
-- Name: schedule_revisions schedule_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_pkey PRIMARY KEY (id);


--
-- Name: schedule_revisions schedule_revisions_space_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_space_id_request_id_key UNIQUE (space_id, request_id);


--
-- Name: scheduled_occurrences scheduled_occurrences_id_schedule_id_space_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_id_schedule_id_space_id_key UNIQUE (id, schedule_id, space_id);


--
-- Name: scheduled_occurrences scheduled_occurrences_id_space_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_id_space_id_key UNIQUE (id, space_id);


--
-- Name: scheduled_occurrences scheduled_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_pkey PRIMARY KEY (id);


--
-- Name: scheduled_occurrences scheduled_occurrences_schedule_id_due_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_schedule_id_due_date_key UNIQUE (schedule_id, due_date);


--
-- Name: schedules schedules_id_space_id_currency_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_id_space_id_currency_key UNIQUE (id, space_id, currency);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: space_memberships space_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_memberships
    ADD CONSTRAINT space_memberships_pkey PRIMARY KEY (space_id, user_id);


--
-- Name: spaces spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);


--
-- Name: wallet_command_requests wallet_command_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_command_requests
    ADD CONSTRAINT wallet_command_requests_pkey PRIMARY KEY (space_id, request_id);


--
-- Name: wallet_movements wallet_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_movements
    ADD CONSTRAINT wallet_movements_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_id_space_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_id_space_id_key UNIQUE (id, space_id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: household_invitation_keys_one_active_idx; Type: INDEX; Schema: private; Owner: postgres
--

CREATE UNIQUE INDEX household_invitation_keys_one_active_idx ON private.household_invitation_keys USING btree ((true)) WHERE (retired_at IS NULL);


--
-- Name: allocation_groups_space_currency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_groups_space_currency_idx ON public.allocation_groups USING btree (space_id, currency);


--
-- Name: allocation_month_commitments_group_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_commitments_group_idx ON public.allocation_month_commitments USING btree (group_id, space_id, currency);


--
-- Name: allocation_month_current_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_current_idx ON public.allocation_month_snapshots USING btree (space_id, month_start, currency, id DESC);


--
-- Name: allocation_month_goal_lines_goal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_goal_lines_goal_idx ON public.allocation_month_goal_lines USING btree (goal_id, space_id, currency);


--
-- Name: allocation_month_goal_lines_group_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_goal_lines_group_idx ON public.allocation_month_goal_lines USING btree (group_id, space_id, currency);


--
-- Name: allocation_month_groups_group_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_groups_group_idx ON public.allocation_month_groups USING btree (group_id, space_id, currency);


--
-- Name: allocation_month_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX allocation_month_initial_idx ON public.allocation_month_snapshots USING btree (space_id, currency, month_start) WHERE (expected_snapshot_id IS NULL);


--
-- Name: allocation_month_roots_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_roots_category_idx ON public.allocation_month_roots USING btree (category_id, space_id, category_kind);


--
-- Name: allocation_month_roots_group_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_roots_group_idx ON public.allocation_month_roots USING btree (group_id, space_id, currency);


--
-- Name: allocation_month_roots_target_revision_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_roots_target_revision_idx ON public.allocation_month_roots USING btree (target_revision_id, space_id);


--
-- Name: allocation_month_snapshots_income_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_snapshots_income_idx ON public.allocation_month_snapshots USING btree (income_plan_revision_id, space_id);


--
-- Name: allocation_month_snapshots_template_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_month_snapshots_template_idx ON public.allocation_month_snapshots USING btree (template_revision_id, space_id, currency);


--
-- Name: allocation_month_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX allocation_month_successor_idx ON public.allocation_month_snapshots USING btree (expected_snapshot_id) WHERE (expected_snapshot_id IS NOT NULL);


--
-- Name: allocation_template_current_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_template_current_idx ON public.allocation_template_revisions USING btree (space_id, currency, id DESC);


--
-- Name: allocation_template_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX allocation_template_initial_idx ON public.allocation_template_revisions USING btree (space_id, currency) WHERE (expected_revision_id IS NULL);


--
-- Name: allocation_template_lines_group_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_template_lines_group_idx ON public.allocation_template_lines USING btree (group_id, space_id, currency);


--
-- Name: allocation_template_roots_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX allocation_template_roots_category_idx ON public.allocation_template_roots USING btree (category_id, space_id, category_kind);


--
-- Name: allocation_template_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX allocation_template_successor_idx ON public.allocation_template_revisions USING btree (expected_revision_id) WHERE (expected_revision_id IS NOT NULL);


--
-- Name: budget_month_carry_links_source_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX budget_month_carry_links_source_idx ON public.budget_month_carry_links USING btree (source_close_id, root_id, carry_minor, source_enabled);


--
-- Name: budget_month_close_current_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX budget_month_close_current_idx ON public.budget_month_closes USING btree (space_id, currency, month_start, id DESC);


--
-- Name: budget_month_close_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX budget_month_close_initial_idx ON public.budget_month_closes USING btree (space_id, currency, month_start) WHERE (expected_close_id IS NULL);


--
-- Name: budget_month_close_roots_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX budget_month_close_roots_category_idx ON public.budget_month_close_roots USING btree (root_id, space_id, root_kind);


--
-- Name: budget_month_close_roots_policy_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX budget_month_close_roots_policy_idx ON public.budget_month_close_roots USING btree (policy_revision_id, space_id, currency, root_id, enabled) WHERE (policy_revision_id IS NOT NULL);


--
-- Name: budget_month_close_roots_snapshot_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX budget_month_close_roots_snapshot_idx ON public.budget_month_close_roots USING btree (source_snapshot_id, root_id, base_target_minor);


--
-- Name: budget_month_close_snapshot_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX budget_month_close_snapshot_idx ON public.budget_month_closes USING btree (source_snapshot_id, space_id, currency, month_start);


--
-- Name: budget_month_close_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX budget_month_close_successor_idx ON public.budget_month_closes USING btree (expected_close_id) WHERE (expected_close_id IS NOT NULL);


--
-- Name: categories_active_hierarchy_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX categories_active_hierarchy_idx ON public.categories USING btree (space_id, kind, parent_category_id, created_at, id) WHERE (archived_at IS NULL);


--
-- Name: categories_active_name_ar_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX categories_active_name_ar_idx ON public.categories USING btree (space_id, kind, name_ar_key) WHERE ((archived_at IS NULL) AND (name_ar_key IS NOT NULL));


--
-- Name: categories_active_name_en_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX categories_active_name_en_idx ON public.categories USING btree (space_id, kind, name_en_key) WHERE ((archived_at IS NULL) AND (name_en_key IS NOT NULL));


--
-- Name: categories_active_page_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX categories_active_page_idx ON public.categories USING btree (space_id, kind, created_at, id) WHERE (archived_at IS NULL);


--
-- Name: categories_parent_fk_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX categories_parent_fk_idx ON public.categories USING btree (parent_category_id, space_id, kind) WHERE (parent_category_id IS NOT NULL);


--
-- Name: category_command_requests_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX category_command_requests_category_idx ON public.category_command_requests USING btree (space_id, category_id);


--
-- Name: financial_event_categories_space_category_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX financial_event_categories_space_category_event_idx ON public.financial_event_categories USING btree (space_id, category_id, event_id);


--
-- Name: financial_event_categories_space_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX financial_event_categories_space_event_idx ON public.financial_event_categories USING btree (space_id, event_id);


--
-- Name: financial_event_descriptions_space_payee_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX financial_event_descriptions_space_payee_event_idx ON public.financial_event_descriptions USING btree (space_id, payee_id, event_id);


--
-- Name: financial_events_one_reversal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX financial_events_one_reversal_idx ON public.financial_events USING btree (reversal_of) WHERE (reversal_of IS NOT NULL);


--
-- Name: financial_events_report_keyset_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX financial_events_report_keyset_idx ON public.financial_events USING btree (space_id, effective_date DESC, created_at DESC, id DESC);


--
-- Name: financial_events_space_keyset_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX financial_events_space_keyset_idx ON public.financial_events USING btree (space_id, effective_date DESC, created_at DESC, id DESC);


--
-- Name: goal_checklist_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX goal_checklist_initial_idx ON public.goal_milestone_events USING btree (milestone_id) WHERE (expected_event_id IS NULL);


--
-- Name: goal_checklist_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX goal_checklist_successor_idx ON public.goal_milestone_events USING btree (expected_event_id) WHERE (expected_event_id IS NOT NULL);


--
-- Name: goal_current_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_current_idx ON public.goal_revisions USING btree (space_id, currency, goal_id, id DESC);


--
-- Name: goal_earmark_events_space_currency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_earmark_events_space_currency_idx ON public.goal_earmark_events USING btree (space_id, currency, id DESC);


--
-- Name: goal_earmark_lines_goal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_earmark_lines_goal_idx ON public.goal_earmark_lines USING btree (goal_id, space_id, currency);


--
-- Name: goal_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX goal_initial_idx ON public.goal_revisions USING btree (goal_id) WHERE (expected_revision_id IS NULL);


--
-- Name: goal_milestone_events_milestone_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_milestone_events_milestone_idx ON public.goal_milestone_events USING btree (milestone_id, space_id, id DESC);


--
-- Name: goal_milestones_goal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_milestones_goal_idx ON public.goal_milestones USING btree (goal_id, space_id, currency);


--
-- Name: goal_month_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX goal_month_initial_idx ON public.goal_monthly_target_revisions USING btree (goal_id, month_start) WHERE (expected_revision_id IS NULL);


--
-- Name: goal_month_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX goal_month_successor_idx ON public.goal_monthly_target_revisions USING btree (expected_revision_id) WHERE (expected_revision_id IS NOT NULL);


--
-- Name: goal_monthly_target_revisions_goal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_monthly_target_revisions_goal_idx ON public.goal_monthly_target_revisions USING btree (goal_id, space_id, currency, month_start DESC);


--
-- Name: goal_purchase_links_expense_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_purchase_links_expense_idx ON public.goal_purchase_links USING btree (expense_event_id, space_id);


--
-- Name: goal_purchase_links_goal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_purchase_links_goal_idx ON public.goal_purchase_links USING btree (goal_id, created_at, id);


--
-- Name: goal_revision_milestones_milestone_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goal_revision_milestones_milestone_idx ON public.goal_revision_milestones USING btree (milestone_id, goal_id, space_id, currency);


--
-- Name: goal_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX goal_successor_idx ON public.goal_revisions USING btree (expected_revision_id) WHERE (expected_revision_id IS NOT NULL);


--
-- Name: goals_space_currency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX goals_space_currency_idx ON public.goals USING btree (space_id, currency);


--
-- Name: household_invitations_accepted_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_invitations_accepted_by_idx ON public.household_invitations USING btree (accepted_by_user_id) WHERE (accepted_by_user_id IS NOT NULL);


--
-- Name: household_invitations_cancelled_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_invitations_cancelled_by_idx ON public.household_invitations USING btree (cancelled_by_user_id) WHERE (cancelled_by_user_id IS NOT NULL);


--
-- Name: household_invitations_created_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_invitations_created_by_idx ON public.household_invitations USING btree (created_by_user_id);


--
-- Name: household_invitations_key_version_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_invitations_key_version_idx ON public.household_invitations USING btree (key_version);


--
-- Name: household_invitations_pending_identity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_invitations_pending_identity_idx ON public.household_invitations USING btree (space_id, invitee_identity_digest, expires_at DESC) WHERE (status = 'pending'::public.household_invitation_status);


--
-- Name: household_invitations_space_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_invitations_space_created_idx ON public.household_invitations USING btree (space_id, created_at DESC, id DESC);


--
-- Name: household_membership_events_invitation_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_membership_events_invitation_idx ON public.household_membership_events USING btree (invitation_id) WHERE (invitation_id IS NOT NULL);


--
-- Name: household_membership_events_space_time_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_membership_events_space_time_idx ON public.household_membership_events USING btree (space_id, occurred_at DESC, id DESC);


--
-- Name: household_membership_events_subject_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX household_membership_events_subject_idx ON public.household_membership_events USING btree (subject_user_id) WHERE (subject_user_id IS NOT NULL);


--
-- Name: loan_monthly_target_revisions_lookup_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX loan_monthly_target_revisions_lookup_idx ON public.loan_monthly_target_revisions USING btree (loan_id, target_month, created_at DESC, id DESC);


--
-- Name: loan_postings_loan_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX loan_postings_loan_event_idx ON public.loan_postings USING btree (loan_id, event_id);


--
-- Name: loan_postings_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX loan_postings_space_idx ON public.loan_postings USING btree (space_id);


--
-- Name: loans_space_direction_currency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX loans_space_direction_currency_idx ON public.loans USING btree (space_id, direction, currency);


--
-- Name: monthly_budget_plan_revisions_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX monthly_budget_plan_revisions_category_idx ON public.monthly_budget_plan_revisions USING btree (category_id, space_id, category_kind) WHERE (category_id IS NOT NULL);


--
-- Name: monthly_budget_plan_revisions_current_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX monthly_budget_plan_revisions_current_idx ON public.monthly_budget_plan_revisions USING btree (space_id, month_start, currency, plan_kind, category_id, id DESC);


--
-- Name: monthly_budget_plan_revisions_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX monthly_budget_plan_revisions_history_idx ON public.monthly_budget_plan_revisions USING btree (space_id, id DESC);


--
-- Name: occurrence_events_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX occurrence_events_initial_idx ON public.occurrence_events USING btree (occurrence_id) WHERE (expected_event_id IS NULL);


--
-- Name: occurrence_events_linked_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX occurrence_events_linked_event_idx ON public.occurrence_events USING btree (linked_event_id) WHERE (linked_event_id IS NOT NULL);


--
-- Name: occurrence_events_occurrence_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX occurrence_events_occurrence_idx ON public.occurrence_events USING btree (occurrence_id, id DESC);


--
-- Name: occurrence_events_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX occurrence_events_successor_idx ON public.occurrence_events USING btree (expected_event_id) WHERE (expected_event_id IS NOT NULL);


--
-- Name: payees_space_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX payees_space_created_idx ON public.payees USING btree (space_id, created_at DESC, id DESC);


--
-- Name: planning_receipts_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX planning_receipts_history_idx ON public.planning_command_receipts USING btree (space_id, sequence_id DESC);


--
-- Name: rollover_policy_current_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rollover_policy_current_idx ON public.rollover_policy_revisions USING btree (space_id, currency, root_id, id DESC);


--
-- Name: rollover_policy_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX rollover_policy_initial_idx ON public.rollover_policy_revisions USING btree (space_id, currency, root_id) WHERE (expected_revision_id IS NULL);


--
-- Name: rollover_policy_root_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rollover_policy_root_idx ON public.rollover_policy_revisions USING btree (root_id, space_id, root_kind);


--
-- Name: rollover_policy_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX rollover_policy_successor_idx ON public.rollover_policy_revisions USING btree (expected_revision_id) WHERE (expected_revision_id IS NOT NULL);


--
-- Name: schedule_initial_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX schedule_initial_idx ON public.schedule_revisions USING btree (schedule_id) WHERE (expected_revision_id IS NULL);


--
-- Name: schedule_revisions_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX schedule_revisions_category_idx ON public.schedule_revisions USING btree (category_id) WHERE (category_id IS NOT NULL);


--
-- Name: schedule_revisions_current_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX schedule_revisions_current_idx ON public.schedule_revisions USING btree (schedule_id, id DESC);


--
-- Name: schedule_revisions_goal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX schedule_revisions_goal_idx ON public.schedule_revisions USING btree (funding_goal_id) WHERE (funding_goal_id IS NOT NULL);


--
-- Name: schedule_revisions_loan_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX schedule_revisions_loan_idx ON public.schedule_revisions USING btree (loan_id) WHERE (loan_id IS NOT NULL);


--
-- Name: schedule_revisions_wallet_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX schedule_revisions_wallet_idx ON public.schedule_revisions USING btree (preferred_wallet_id) WHERE (preferred_wallet_id IS NOT NULL);


--
-- Name: schedule_successor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX schedule_successor_idx ON public.schedule_revisions USING btree (expected_revision_id) WHERE (expected_revision_id IS NOT NULL);


--
-- Name: scheduled_occurrences_goal_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX scheduled_occurrences_goal_idx ON public.scheduled_occurrences USING btree (funding_goal_id) WHERE (funding_goal_id IS NOT NULL);


--
-- Name: scheduled_occurrences_page_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX scheduled_occurrences_page_idx ON public.scheduled_occurrences USING btree (space_id, due_date, id);


--
-- Name: scheduled_occurrences_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX scheduled_occurrences_schedule_idx ON public.scheduled_occurrences USING btree (schedule_id, due_date);


--
-- Name: schedules_space_currency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX schedules_space_currency_idx ON public.schedules USING btree (space_id, currency);


--
-- Name: space_memberships_active_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX space_memberships_active_owner_idx ON public.space_memberships USING btree (space_id, user_id) WHERE ((status = 'active'::public.membership_status) AND (role = 'owner'::public.member_role));


--
-- Name: space_memberships_active_user_space_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX space_memberships_active_user_space_idx ON public.space_memberships USING btree (user_id, space_id) WHERE (status = 'active'::public.membership_status);


--
-- Name: space_memberships_ended_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX space_memberships_ended_by_idx ON public.space_memberships USING btree (ended_by_user_id) WHERE (ended_by_user_id IS NOT NULL);


--
-- Name: wallet_command_requests_wallet_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wallet_command_requests_wallet_idx ON public.wallet_command_requests USING btree (space_id, wallet_id);


--
-- Name: wallet_movements_event_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wallet_movements_event_idx ON public.wallet_movements USING btree (event_id);


--
-- Name: wallet_movements_wallet_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wallet_movements_wallet_created_idx ON public.wallet_movements USING btree (wallet_id, created_at DESC);


--
-- Name: wallets_space_currency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wallets_space_currency_idx ON public.wallets USING btree (space_id, currency) WHERE (archived_at IS NULL);


--
-- Name: allocation_groups allocation_groups_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_groups
    ADD CONSTRAINT allocation_groups_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: allocation_groups allocation_groups_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_groups
    ADD CONSTRAINT allocation_groups_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: allocation_month_commitments allocation_month_commitments_snapshot_id_group_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_commitments
    ADD CONSTRAINT allocation_month_commitments_snapshot_id_group_id_space_id_fkey FOREIGN KEY (snapshot_id, group_id, space_id, currency) REFERENCES public.allocation_month_groups(snapshot_id, group_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_month_commitments allocation_month_commitments_snapshot_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_commitments
    ADD CONSTRAINT allocation_month_commitments_snapshot_id_space_id_currency_fkey FOREIGN KEY (snapshot_id, space_id, currency) REFERENCES public.allocation_month_snapshots(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_month_goal_lines allocation_month_goal_lines_snapshot_id_group_id_space_id__fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_goal_lines
    ADD CONSTRAINT allocation_month_goal_lines_snapshot_id_group_id_space_id__fkey FOREIGN KEY (snapshot_id, group_id, space_id, currency) REFERENCES public.allocation_month_groups(snapshot_id, group_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_month_goal_lines allocation_month_goal_lines_snapshot_id_space_id_currency__fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_goal_lines
    ADD CONSTRAINT allocation_month_goal_lines_snapshot_id_space_id_currency__fkey FOREIGN KEY (snapshot_id, space_id, currency, month_start) REFERENCES public.allocation_month_snapshots(id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: allocation_month_goal_lines allocation_month_goal_lines_target_revision_id_goal_id_spa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_goal_lines
    ADD CONSTRAINT allocation_month_goal_lines_target_revision_id_goal_id_spa_fkey FOREIGN KEY (target_revision_id, goal_id, space_id, currency, month_start) REFERENCES public.goal_monthly_target_revisions(id, goal_id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: allocation_month_groups allocation_month_groups_group_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_groups
    ADD CONSTRAINT allocation_month_groups_group_id_space_id_currency_fkey FOREIGN KEY (group_id, space_id, currency) REFERENCES public.allocation_groups(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_month_groups allocation_month_groups_snapshot_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_groups
    ADD CONSTRAINT allocation_month_groups_snapshot_id_space_id_currency_fkey FOREIGN KEY (snapshot_id, space_id, currency) REFERENCES public.allocation_month_snapshots(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_month_roots allocation_month_roots_category_id_space_id_category_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_roots
    ADD CONSTRAINT allocation_month_roots_category_id_space_id_category_kind_fkey FOREIGN KEY (category_id, space_id, category_kind) REFERENCES public.categories(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: allocation_month_roots allocation_month_roots_snapshot_id_group_id_space_id_curre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_roots
    ADD CONSTRAINT allocation_month_roots_snapshot_id_group_id_space_id_curre_fkey FOREIGN KEY (snapshot_id, group_id, space_id, currency) REFERENCES public.allocation_month_groups(snapshot_id, group_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_month_roots allocation_month_roots_snapshot_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_roots
    ADD CONSTRAINT allocation_month_roots_snapshot_id_space_id_currency_fkey FOREIGN KEY (snapshot_id, space_id, currency) REFERENCES public.allocation_month_snapshots(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_month_roots allocation_month_roots_target_revision_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_roots
    ADD CONSTRAINT allocation_month_roots_target_revision_id_space_id_fkey FOREIGN KEY (target_revision_id, space_id) REFERENCES public.monthly_budget_plan_revisions(id, space_id) ON DELETE RESTRICT;


--
-- Name: allocation_month_snapshots allocation_month_snapshots_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: allocation_month_snapshots allocation_month_snapshots_expected_snapshot_id_space_id_c_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_expected_snapshot_id_space_id_c_fkey FOREIGN KEY (expected_snapshot_id, space_id, currency, month_start) REFERENCES public.allocation_month_snapshots(id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: allocation_month_snapshots allocation_month_snapshots_income_plan_revision_id_space_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_income_plan_revision_id_space_i_fkey FOREIGN KEY (income_plan_revision_id, space_id) REFERENCES public.monthly_budget_plan_revisions(id, space_id) ON DELETE RESTRICT;


--
-- Name: allocation_month_snapshots allocation_month_snapshots_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: allocation_month_snapshots allocation_month_snapshots_template_revision_id_space_id_c_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_month_snapshots
    ADD CONSTRAINT allocation_month_snapshots_template_revision_id_space_id_c_fkey FOREIGN KEY (template_revision_id, space_id, currency) REFERENCES public.allocation_template_revisions(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_template_lines allocation_template_lines_group_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_lines
    ADD CONSTRAINT allocation_template_lines_group_id_space_id_currency_fkey FOREIGN KEY (group_id, space_id, currency) REFERENCES public.allocation_groups(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_template_lines allocation_template_lines_template_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_lines
    ADD CONSTRAINT allocation_template_lines_template_id_space_id_currency_fkey FOREIGN KEY (template_id, space_id, currency) REFERENCES public.allocation_template_revisions(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_template_revisions allocation_template_revisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_revisions
    ADD CONSTRAINT allocation_template_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: allocation_template_revisions allocation_template_revisions_expected_revision_id_space_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_revisions
    ADD CONSTRAINT allocation_template_revisions_expected_revision_id_space_i_fkey FOREIGN KEY (expected_revision_id, space_id, currency) REFERENCES public.allocation_template_revisions(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: allocation_template_revisions allocation_template_revisions_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_revisions
    ADD CONSTRAINT allocation_template_revisions_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: allocation_template_roots allocation_template_roots_category_id_space_id_category_ki_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_roots
    ADD CONSTRAINT allocation_template_roots_category_id_space_id_category_ki_fkey FOREIGN KEY (category_id, space_id, category_kind) REFERENCES public.categories(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: allocation_template_roots allocation_template_roots_template_id_group_id_space_id_cu_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_template_roots
    ADD CONSTRAINT allocation_template_roots_template_id_group_id_space_id_cu_fkey FOREIGN KEY (template_id, group_id, space_id, currency) REFERENCES public.allocation_template_lines(template_id, group_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: budget_month_carry_links budget_month_carry_links_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_carry_links
    ADD CONSTRAINT budget_month_carry_links_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: budget_month_carry_links budget_month_carry_links_source_close_id_root_id_carry_min_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_carry_links
    ADD CONSTRAINT budget_month_carry_links_source_close_id_root_id_carry_min_fkey FOREIGN KEY (source_close_id, root_id, carry_minor, source_enabled) REFERENCES public.budget_month_close_roots(close_id, root_id, outgoing_carry_minor, enabled) ON DELETE RESTRICT;


--
-- Name: budget_month_carry_links budget_month_carry_links_source_close_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_carry_links
    ADD CONSTRAINT budget_month_carry_links_source_close_id_space_id_currency_fkey FOREIGN KEY (source_close_id, space_id, currency, source_month_start) REFERENCES public.budget_month_closes(id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: budget_month_carry_links budget_month_carry_links_target_snapshot_id_root_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_carry_links
    ADD CONSTRAINT budget_month_carry_links_target_snapshot_id_root_id_fkey FOREIGN KEY (target_snapshot_id, root_id) REFERENCES public.allocation_month_roots(snapshot_id, category_id) ON DELETE RESTRICT;


--
-- Name: budget_month_carry_links budget_month_carry_links_target_snapshot_id_space_id_curre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_carry_links
    ADD CONSTRAINT budget_month_carry_links_target_snapshot_id_space_id_curre_fkey FOREIGN KEY (target_snapshot_id, space_id, currency, target_month_start) REFERENCES public.allocation_month_snapshots(id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: budget_month_close_roots budget_month_close_roots_close_id_space_id_currency_month__fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_close_roots
    ADD CONSTRAINT budget_month_close_roots_close_id_space_id_currency_month__fkey FOREIGN KEY (close_id, space_id, currency, month_start, source_snapshot_id) REFERENCES public.budget_month_closes(id, space_id, currency, month_start, source_snapshot_id) ON DELETE RESTRICT;


--
-- Name: budget_month_close_roots budget_month_close_roots_policy_revision_id_space_id_curre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_close_roots
    ADD CONSTRAINT budget_month_close_roots_policy_revision_id_space_id_curre_fkey FOREIGN KEY (policy_revision_id, space_id, currency, root_id, enabled) REFERENCES public.rollover_policy_revisions(id, space_id, currency, root_id, enabled) ON DELETE RESTRICT;


--
-- Name: budget_month_close_roots budget_month_close_roots_root_id_space_id_root_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_close_roots
    ADD CONSTRAINT budget_month_close_roots_root_id_space_id_root_kind_fkey FOREIGN KEY (root_id, space_id, root_kind) REFERENCES public.categories(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: budget_month_close_roots budget_month_close_roots_source_snapshot_id_root_id_base_t_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_close_roots
    ADD CONSTRAINT budget_month_close_roots_source_snapshot_id_root_id_base_t_fkey FOREIGN KEY (source_snapshot_id, root_id, base_target_minor) REFERENCES public.allocation_month_roots(snapshot_id, category_id, target_minor) ON DELETE RESTRICT;


--
-- Name: budget_month_closes budget_month_closes_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: budget_month_closes budget_month_closes_expected_close_id_space_id_currency_mo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_expected_close_id_space_id_currency_mo_fkey FOREIGN KEY (expected_close_id, space_id, currency, month_start) REFERENCES public.budget_month_closes(id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: budget_month_closes budget_month_closes_source_snapshot_id_space_id_currency_m_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_source_snapshot_id_space_id_currency_m_fkey FOREIGN KEY (source_snapshot_id, space_id, currency, month_start) REFERENCES public.allocation_month_snapshots(id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: budget_month_closes budget_month_closes_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.budget_month_closes
    ADD CONSTRAINT budget_month_closes_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: categories categories_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: categories categories_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: categories categories_parent_space_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_space_kind_fkey FOREIGN KEY (parent_category_id, space_id, kind) REFERENCES public.categories(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: categories categories_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: category_command_requests category_command_requests_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_command_requests
    ADD CONSTRAINT category_command_requests_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: category_command_requests category_command_requests_category_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_command_requests
    ADD CONSTRAINT category_command_requests_category_id_space_id_fkey FOREIGN KEY (category_id, space_id) REFERENCES public.categories(id, space_id) ON DELETE RESTRICT;


--
-- Name: category_command_requests category_command_requests_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_command_requests
    ADD CONSTRAINT category_command_requests_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: financial_event_categories financial_event_categories_category_id_space_id_category_k_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_categories
    ADD CONSTRAINT financial_event_categories_category_id_space_id_category_k_fkey FOREIGN KEY (category_id, space_id, category_kind) REFERENCES public.categories(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: financial_event_categories financial_event_categories_event_id_space_id_event_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_categories
    ADD CONSTRAINT financial_event_categories_event_id_space_id_event_kind_fkey FOREIGN KEY (event_id, space_id, event_kind) REFERENCES public.financial_events(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: financial_event_description_requests financial_event_description_requests_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_description_requests
    ADD CONSTRAINT financial_event_description_requests_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: financial_event_description_requests financial_event_description_requests_event_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_description_requests
    ADD CONSTRAINT financial_event_description_requests_event_id_space_id_fkey FOREIGN KEY (event_id, space_id) REFERENCES public.financial_events(id, space_id) ON DELETE RESTRICT;


--
-- Name: financial_event_description_requests financial_event_description_requests_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_description_requests
    ADD CONSTRAINT financial_event_description_requests_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: financial_event_descriptions financial_event_descriptions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_descriptions
    ADD CONSTRAINT financial_event_descriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: financial_event_descriptions financial_event_descriptions_event_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_descriptions
    ADD CONSTRAINT financial_event_descriptions_event_id_space_id_fkey FOREIGN KEY (event_id, space_id) REFERENCES public.financial_events(id, space_id) ON DELETE RESTRICT;


--
-- Name: financial_event_descriptions financial_event_descriptions_payee_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_event_descriptions
    ADD CONSTRAINT financial_event_descriptions_payee_id_space_id_fkey FOREIGN KEY (payee_id, space_id) REFERENCES public.payees(id, space_id) ON DELETE RESTRICT;


--
-- Name: financial_events financial_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_events
    ADD CONSTRAINT financial_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: financial_events financial_events_reversal_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_events
    ADD CONSTRAINT financial_events_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES public.financial_events(id) ON DELETE RESTRICT;


--
-- Name: financial_events financial_events_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_events
    ADD CONSTRAINT financial_events_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: goal_earmark_events goal_earmark_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_events
    ADD CONSTRAINT goal_earmark_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: goal_earmark_events goal_earmark_events_reversal_of_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_events
    ADD CONSTRAINT goal_earmark_events_reversal_of_space_id_currency_fkey FOREIGN KEY (reversal_of, space_id, currency) REFERENCES public.goal_earmark_events(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_earmark_events goal_earmark_events_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_events
    ADD CONSTRAINT goal_earmark_events_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: goal_earmark_lines goal_earmark_lines_event_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_lines
    ADD CONSTRAINT goal_earmark_lines_event_id_space_id_currency_fkey FOREIGN KEY (event_id, space_id, currency) REFERENCES public.goal_earmark_events(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_earmark_lines goal_earmark_lines_goal_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_earmark_lines
    ADD CONSTRAINT goal_earmark_lines_goal_id_space_id_currency_fkey FOREIGN KEY (goal_id, space_id, currency) REFERENCES public.goals(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_milestone_events goal_milestone_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestone_events
    ADD CONSTRAINT goal_milestone_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: goal_milestone_events goal_milestone_events_expected_event_id_milestone_id_space_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestone_events
    ADD CONSTRAINT goal_milestone_events_expected_event_id_milestone_id_space_fkey FOREIGN KEY (expected_event_id, milestone_id, space_id) REFERENCES public.goal_milestone_events(id, milestone_id, space_id) ON DELETE RESTRICT;


--
-- Name: goal_milestone_events goal_milestone_events_milestone_id_goal_id_space_id_curren_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestone_events
    ADD CONSTRAINT goal_milestone_events_milestone_id_goal_id_space_id_curren_fkey FOREIGN KEY (milestone_id, goal_id, space_id, currency) REFERENCES public.goal_milestones(id, goal_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_milestones goal_milestones_goal_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_milestones
    ADD CONSTRAINT goal_milestones_goal_id_space_id_currency_fkey FOREIGN KEY (goal_id, space_id, currency) REFERENCES public.goals(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_monthly_target_revisions
    ADD CONSTRAINT goal_monthly_target_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_expected_revision_id_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_monthly_target_revisions
    ADD CONSTRAINT goal_monthly_target_revisions_expected_revision_id_goal_id_fkey FOREIGN KEY (expected_revision_id, goal_id, space_id, currency, month_start) REFERENCES public.goal_monthly_target_revisions(id, goal_id, space_id, currency, month_start) ON DELETE RESTRICT;


--
-- Name: goal_monthly_target_revisions goal_monthly_target_revisions_goal_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_monthly_target_revisions
    ADD CONSTRAINT goal_monthly_target_revisions_goal_id_space_id_currency_fkey FOREIGN KEY (goal_id, space_id, currency) REFERENCES public.goals(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_purchase_links goal_purchase_links_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_purchase_links
    ADD CONSTRAINT goal_purchase_links_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: goal_purchase_links goal_purchase_links_expense_event_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_purchase_links
    ADD CONSTRAINT goal_purchase_links_expense_event_id_space_id_fkey FOREIGN KEY (expense_event_id, space_id) REFERENCES public.financial_events(id, space_id) ON DELETE RESTRICT;


--
-- Name: goal_purchase_links goal_purchase_links_goal_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_purchase_links
    ADD CONSTRAINT goal_purchase_links_goal_id_space_id_currency_fkey FOREIGN KEY (goal_id, space_id, currency) REFERENCES public.goals(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_revision_milestones goal_revision_milestones_milestone_id_goal_id_space_id_cur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revision_milestones
    ADD CONSTRAINT goal_revision_milestones_milestone_id_goal_id_space_id_cur_fkey FOREIGN KEY (milestone_id, goal_id, space_id, currency) REFERENCES public.goal_milestones(id, goal_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_revision_milestones goal_revision_milestones_revision_id_goal_id_space_id_curr_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revision_milestones
    ADD CONSTRAINT goal_revision_milestones_revision_id_goal_id_space_id_curr_fkey FOREIGN KEY (revision_id, goal_id, space_id, currency) REFERENCES public.goal_revisions(id, goal_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_revisions goal_revisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revisions
    ADD CONSTRAINT goal_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: goal_revisions goal_revisions_expected_revision_id_goal_id_space_id_curre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revisions
    ADD CONSTRAINT goal_revisions_expected_revision_id_goal_id_space_id_curre_fkey FOREIGN KEY (expected_revision_id, goal_id, space_id, currency) REFERENCES public.goal_revisions(id, goal_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goal_revisions goal_revisions_goal_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goal_revisions
    ADD CONSTRAINT goal_revisions_goal_id_space_id_currency_fkey FOREIGN KEY (goal_id, space_id, currency) REFERENCES public.goals(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: goals goals_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: goals goals_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: household_invitations household_invitations_accepted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_invitations
    ADD CONSTRAINT household_invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: household_invitations household_invitations_cancelled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_invitations
    ADD CONSTRAINT household_invitations_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: household_invitations household_invitations_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_invitations
    ADD CONSTRAINT household_invitations_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: household_invitations household_invitations_key_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_invitations
    ADD CONSTRAINT household_invitations_key_version_fkey FOREIGN KEY (key_version) REFERENCES private.household_invitation_keys(key_version) ON DELETE RESTRICT;


--
-- Name: household_invitations household_invitations_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_invitations
    ADD CONSTRAINT household_invitations_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: household_membership_events household_membership_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_membership_events
    ADD CONSTRAINT household_membership_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: household_membership_events household_membership_events_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_membership_events
    ADD CONSTRAINT household_membership_events_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.household_invitations(id) ON DELETE RESTRICT;


--
-- Name: household_membership_events household_membership_events_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_membership_events
    ADD CONSTRAINT household_membership_events_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: household_membership_events household_membership_events_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.household_membership_events
    ADD CONSTRAINT household_membership_events_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_monthly_target_revisions
    ADD CONSTRAINT loan_monthly_target_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_loan_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_monthly_target_revisions
    ADD CONSTRAINT loan_monthly_target_revisions_loan_id_space_id_fkey FOREIGN KEY (loan_id, space_id) REFERENCES public.loans(id, space_id) ON DELETE RESTRICT;


--
-- Name: loan_monthly_target_revisions loan_monthly_target_revisions_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_monthly_target_revisions
    ADD CONSTRAINT loan_monthly_target_revisions_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: loan_postings loan_postings_event_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_postings
    ADD CONSTRAINT loan_postings_event_id_space_id_fkey FOREIGN KEY (event_id, space_id) REFERENCES public.financial_events(id, space_id) ON DELETE RESTRICT;


--
-- Name: loan_postings loan_postings_loan_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loan_postings
    ADD CONSTRAINT loan_postings_loan_id_space_id_fkey FOREIGN KEY (loan_id, space_id) REFERENCES public.loans(id, space_id) ON DELETE RESTRICT;


--
-- Name: loans loans_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: loans loans_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.monthly_budget_plan_revisions
    ADD CONSTRAINT monthly_budget_plan_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_category_id_space_id_categor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.monthly_budget_plan_revisions
    ADD CONSTRAINT monthly_budget_plan_revisions_category_id_space_id_categor_fkey FOREIGN KEY (category_id, space_id, category_kind) REFERENCES public.categories(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: monthly_budget_plan_revisions monthly_budget_plan_revisions_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.monthly_budget_plan_revisions
    ADD CONSTRAINT monthly_budget_plan_revisions_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: occurrence_events occurrence_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.occurrence_events
    ADD CONSTRAINT occurrence_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: occurrence_events occurrence_events_expected_event_id_occurrence_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.occurrence_events
    ADD CONSTRAINT occurrence_events_expected_event_id_occurrence_id_space_id_fkey FOREIGN KEY (expected_event_id, occurrence_id, space_id) REFERENCES public.occurrence_events(id, occurrence_id, space_id) ON DELETE RESTRICT;


--
-- Name: occurrence_events occurrence_events_linked_event_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.occurrence_events
    ADD CONSTRAINT occurrence_events_linked_event_id_space_id_fkey FOREIGN KEY (linked_event_id, space_id) REFERENCES public.financial_events(id, space_id) ON DELETE RESTRICT;


--
-- Name: occurrence_events occurrence_events_occurrence_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.occurrence_events
    ADD CONSTRAINT occurrence_events_occurrence_id_space_id_fkey FOREIGN KEY (occurrence_id, space_id) REFERENCES public.scheduled_occurrences(id, space_id) ON DELETE RESTRICT;


--
-- Name: payees payees_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payees
    ADD CONSTRAINT payees_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: payees payees_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payees
    ADD CONSTRAINT payees_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: planning_command_receipts planning_command_receipts_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planning_command_receipts
    ADD CONSTRAINT planning_command_receipts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: planning_command_receipts planning_command_receipts_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planning_command_receipts
    ADD CONSTRAINT planning_command_receipts_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: rollover_policy_revisions rollover_policy_revisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: rollover_policy_revisions rollover_policy_revisions_expected_revision_id_space_id_cu_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_expected_revision_id_space_id_cu_fkey FOREIGN KEY (expected_revision_id, space_id, currency, root_id) REFERENCES public.rollover_policy_revisions(id, space_id, currency, root_id) ON DELETE RESTRICT;


--
-- Name: rollover_policy_revisions rollover_policy_revisions_root_id_space_id_root_kind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_root_id_space_id_root_kind_fkey FOREIGN KEY (root_id, space_id, root_kind) REFERENCES public.categories(id, space_id, kind) ON DELETE RESTRICT;


--
-- Name: rollover_policy_revisions rollover_policy_revisions_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rollover_policy_revisions
    ADD CONSTRAINT rollover_policy_revisions_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: schedule_revisions schedule_revisions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: schedule_revisions schedule_revisions_category_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_category_id_space_id_fkey FOREIGN KEY (category_id, space_id) REFERENCES public.categories(id, space_id) ON DELETE RESTRICT;


--
-- Name: schedule_revisions schedule_revisions_expected_revision_id_schedule_id_space__fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_expected_revision_id_schedule_id_space__fkey FOREIGN KEY (expected_revision_id, schedule_id, space_id, currency) REFERENCES public.schedule_revisions(id, schedule_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: schedule_revisions schedule_revisions_funding_goal_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_funding_goal_id_space_id_currency_fkey FOREIGN KEY (funding_goal_id, space_id, currency) REFERENCES public.goals(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: schedule_revisions schedule_revisions_loan_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_loan_id_space_id_fkey FOREIGN KEY (loan_id, space_id) REFERENCES public.loans(id, space_id) ON DELETE RESTRICT;


--
-- Name: schedule_revisions schedule_revisions_preferred_wallet_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_preferred_wallet_id_space_id_fkey FOREIGN KEY (preferred_wallet_id, space_id) REFERENCES public.wallets(id, space_id) ON DELETE RESTRICT;


--
-- Name: schedule_revisions schedule_revisions_schedule_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedule_revisions
    ADD CONSTRAINT schedule_revisions_schedule_id_space_id_currency_fkey FOREIGN KEY (schedule_id, space_id, currency) REFERENCES public.schedules(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: scheduled_occurrences scheduled_occurrences_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: scheduled_occurrences scheduled_occurrences_category_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_category_id_space_id_fkey FOREIGN KEY (category_id, space_id) REFERENCES public.categories(id, space_id) ON DELETE RESTRICT;


--
-- Name: scheduled_occurrences scheduled_occurrences_funding_goal_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_funding_goal_id_space_id_currency_fkey FOREIGN KEY (funding_goal_id, space_id, currency) REFERENCES public.goals(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: scheduled_occurrences scheduled_occurrences_loan_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_loan_id_space_id_fkey FOREIGN KEY (loan_id, space_id) REFERENCES public.loans(id, space_id) ON DELETE RESTRICT;


--
-- Name: scheduled_occurrences scheduled_occurrences_preferred_wallet_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_preferred_wallet_id_space_id_fkey FOREIGN KEY (preferred_wallet_id, space_id) REFERENCES public.wallets(id, space_id) ON DELETE RESTRICT;


--
-- Name: scheduled_occurrences scheduled_occurrences_schedule_id_space_id_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_schedule_id_space_id_currency_fkey FOREIGN KEY (schedule_id, space_id, currency) REFERENCES public.schedules(id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: scheduled_occurrences scheduled_occurrences_source_revision_id_schedule_id_space_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_occurrences
    ADD CONSTRAINT scheduled_occurrences_source_revision_id_schedule_id_space_fkey FOREIGN KEY (source_revision_id, schedule_id, space_id, currency) REFERENCES public.schedule_revisions(id, schedule_id, space_id, currency) ON DELETE RESTRICT;


--
-- Name: schedules schedules_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: schedules schedules_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: space_memberships space_memberships_ended_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_memberships
    ADD CONSTRAINT space_memberships_ended_by_user_id_fkey FOREIGN KEY (ended_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: space_memberships space_memberships_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_memberships
    ADD CONSTRAINT space_memberships_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: space_memberships space_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.space_memberships
    ADD CONSTRAINT space_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: wallet_command_requests wallet_command_requests_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_command_requests
    ADD CONSTRAINT wallet_command_requests_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: wallet_command_requests wallet_command_requests_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_command_requests
    ADD CONSTRAINT wallet_command_requests_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- Name: wallet_command_requests wallet_command_requests_wallet_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_command_requests
    ADD CONSTRAINT wallet_command_requests_wallet_fkey FOREIGN KEY (wallet_id, space_id) REFERENCES public.wallets(id, space_id) ON DELETE RESTRICT;


--
-- Name: wallet_movements wallet_movements_event_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_movements
    ADD CONSTRAINT wallet_movements_event_id_space_id_fkey FOREIGN KEY (event_id, space_id) REFERENCES public.financial_events(id, space_id) ON DELETE RESTRICT;


--
-- Name: wallet_movements wallet_movements_wallet_id_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_movements
    ADD CONSTRAINT wallet_movements_wallet_id_space_id_fkey FOREIGN KEY (wallet_id, space_id) REFERENCES public.wallets(id, space_id) ON DELETE RESTRICT;


--
-- Name: wallets wallets_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--



-- Put the session settings the export changed back, so later migrations on this connection are unaffected.
select pg_catalog.set_config('search_path', '"$user", public, extensions', false);
reset statement_timeout; reset lock_timeout; reset idle_in_transaction_session_timeout; reset transaction_timeout;
reset check_function_bodies; reset row_security; reset client_min_messages; reset xmloption;
