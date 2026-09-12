alter table public.monthly_budget_plan_revisions
  drop constraint monthly_budget_plan_revisions_shape_check;

alter table public.monthly_budget_plan_revisions
  add constraint monthly_budget_plan_revisions_shape_check check ((
    (plan_kind = 'income' and category_id is null and category_kind is null)
    or (plan_kind = 'expense_category' and category_id is not null and category_kind = 'expense')
  ) is true);
