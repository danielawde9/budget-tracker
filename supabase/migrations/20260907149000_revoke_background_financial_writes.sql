revoke insert, update, delete, truncate
on table
  public.wallets,
  public.financial_events,
  public.wallet_movements,
  public.loans,
  public.loan_postings,
  public.loan_monthly_target_revisions
from service_role;
