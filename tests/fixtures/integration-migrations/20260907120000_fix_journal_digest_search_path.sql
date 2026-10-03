alter function public.record_financial_event(
  uuid,
  uuid,
  public.financial_event_kind,
  date,
  jsonb
)
set search_path = pg_catalog, extensions;
