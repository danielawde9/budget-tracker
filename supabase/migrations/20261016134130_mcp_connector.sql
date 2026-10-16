-- Worker-issued OAuth tokens never contain a Supabase user token.
-- Only hashed, revocable connection credentials reach this narrow anonymous API.
create table budget.mcp_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  space_id uuid not null references budget.spaces(id),
  client_name text not null check (char_length(client_name) between 1 and 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  revoked_at timestamptz,
  token_hash text not null unique,
  code_hash text,
  code_expires_at timestamptz,
  activated_at timestamptz,
  primary key (user_id, client_id)
);
alter table budget.mcp_grants enable row level security;

create table budget.mcp_receipts (
  user_id uuid not null,
  client_id text not null,
  request_id uuid not null,
  ledger_request uuid not null unique,
  payload jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id, request_id),
  foreign key (user_id, client_id) references budget.mcp_grants(user_id, client_id) on delete cascade
);
alter table budget.mcp_receipts enable row level security;

create function budget.mcp_browser_only() returns void
language plpgsql stable set search_path = '' as $$
begin
  if (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id') is not null
     or (select auth.uid()) is null then
    raise exception using errcode='42501', message='BUDGET_MCP_BROWSER_REQUIRED';
  end if;
end $$;

create function public.mcp_grant_client(p_client text, p_space uuid, p_name text, p_token_hash text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform budget.mcp_browser_only();
  if p_client is null or char_length(p_client) not between 1 and 256
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
    or nullif(btrim(p_name),'') is null or char_length(p_name)>120
    or not exists (select 1 from budget.space_members where space_id=p_space and user_id=(select auth.uid()) and role='owner') then
    raise exception using errcode='42501', message='BUDGET_MCP_OWNER_REQUIRED';
  end if;
  insert into budget.mcp_grants(user_id,client_id,space_id,client_name,token_hash,code_hash,code_expires_at)
    values ((select auth.uid()),p_client,p_space,btrim(p_name),p_token_hash,p_code_hash,now()+interval '5 minutes')
    on conflict (user_id,client_id) do update set space_id=excluded.space_id,
      client_name=excluded.client_name, revoked_at=null, expires_at=now()+interval '90 days',
      token_hash=excluded.token_hash,code_hash=excluded.code_hash,code_expires_at=excluded.code_expires_at,activated_at=null;
  return jsonb_build_object('ok',true);
end $$;

create function public.mcp_connections() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform budget.mcp_browser_only();
  return coalesce((select jsonb_agg(jsonb_build_object('clientId',client_id,'name',client_name,
    'spaceId',space_id,'expiresAt',expires_at) order by created_at)
    from budget.mcp_grants where user_id=(select auth.uid()) and revoked_at is null and expires_at>now()),'[]'::jsonb);
end $$;

create function public.mcp_revoke_client(p_client text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform budget.mcp_browser_only();
  update budget.mcp_grants set revoked_at=now() where user_id=(select auth.uid()) and client_id=p_client;
  return jsonb_build_object('ok',true);
end $$;

create function public.mcp_exchange_code(p_client text,p_code text,p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g budget.mcp_grants;
begin
  if p_code is null or p_code !~ '^[a-f0-9]{64}$' or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501',message='BUDGET_MCP_UNAUTHORIZED';
  end if;
  update budget.mcp_grants set code_hash=null,code_expires_at=null,activated_at=now()
    where client_id=p_client and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      and code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') and code_expires_at>now()
      and revoked_at is null and expires_at>now()
    returning * into g;
  if not found then raise exception using errcode='42501',message='BUDGET_MCP_UNAUTHORIZED'; end if;
  return jsonb_build_object('userId',g.user_id,'clientId',g.client_id,'spaceId',g.space_id);
end $$;

create function budget.mcp_require_grant(p_token text) returns budget.mcp_grants
language plpgsql set search_path = '' as $$
declare g budget.mcp_grants;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501',message='BUDGET_MCP_UNAUTHORIZED';
  end if;
  select * into g from budget.mcp_grants
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      and activated_at is not null and revoked_at is null and expires_at>now() for share;
  if not found or not exists (select 1 from budget.space_members
      where space_id=g.space_id and user_id=g.user_id and role='owner') then
    raise exception using errcode='42501',message='BUDGET_MCP_UNAUTHORIZED';
  end if;
  return g;
end $$;

create function public.mcp_context(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g budget.mcp_grants := budget.mcp_require_grant(p_token);
  v_result jsonb;
begin
  select jsonb_build_object('spaceId',s.id,'spaceName',s.name,'timezone',s.timezone,
    'today',budget.space_today(s.id),'grantExpiresAt',g.expires_at,
    'wallets',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'currency',w.currency) order by w.name)
      from budget.wallets w where w.space_id=s.id and w.kind='cash' and w.archived_at is null),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'nameEn',i.name_en,'nameAr',i.name_ar,'kind',i.kind,
      'groupNameEn',pg.name_en,'groupNameAr',pg.name_ar) order by i.name_en,i.id)
      from budget.items i left join budget.plan_groups pg on pg.id=i.group_id
      where i.space_id=s.id and i.archived_at is null and i.kind in ('spending','reserve','goal','flex')),'[]'::jsonb))
    into v_result from budget.spaces s where s.id=g.space_id;
  return v_result;
end $$;

create function public.mcp_record_entry(p_token text,p_request uuid,p_kind text,p_wallet uuid,p_currency text,
  p_amount text,p_on date,p_item uuid default null,p_memo text default null,p_cover_ready boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g budget.mcp_grants := budget.mcp_require_grant(p_token);
  v_payload jsonb := jsonb_build_object('kind',p_kind,'wallet',p_wallet,'currency',p_currency,
    'amount',p_amount,'on',p_on,'item',p_item,'memo',p_memo,'coverReady',p_cover_ready);
  v_old budget.mcp_receipts;
  v_request uuid := gen_random_uuid();
  v_result jsonb;
  v_receipt jsonb;
  v_wallet budget.wallets;
begin
  if p_request is null or p_kind is null or p_kind not in ('income','expense')
    or p_amount is null or p_amount !~ '^[1-9][0-9]{0,15}$' or p_amount::numeric>1000000000000000
    or p_on is null or p_cover_ready is null
    or (p_kind='income' and (p_item is not null or p_cover_ready))
    or (p_kind='expense' and p_item is null) then
    perform budget.raise_budget('BUDGET_INVALID_INPUT');
  end if;
  perform set_config('request.jwt.claim.sub',g.user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',g.user_id,'role','anon')::text,true);
  perform budget.lock_space(g.space_id);
  select * into v_old from budget.mcp_receipts where user_id=g.user_id and client_id=g.client_id and request_id=p_request;
  if found then
    if v_old.payload<>v_payload or v_old.receipt->>'spaceId'<>g.space_id::text then
      perform budget.raise_budget('BUDGET_REQUEST_CONFLICT');
    end if;
    return v_old.receipt;
  end if;
  v_wallet := budget.active_wallet(g.space_id,p_wallet);
  if v_wallet.kind<>'cash' or p_currency is distinct from v_wallet.currency::text then
    perform budget.raise_budget('BUDGET_INVALID_INPUT');
  end if;
  if p_kind='income' then
    v_result := public.record_income(g.space_id,v_request,p_wallet,p_amount::bigint,p_on,p_memo);
  else
    if not exists(select 1 from budget.items where id=p_item and space_id=g.space_id
      and archived_at is null and kind in ('spending','reserve','goal','flex')) then
      perform budget.raise_budget('BUDGET_INVALID_INPUT');
    end if;
    v_result := public.record_expense(g.space_id,v_request,p_wallet,p_item,p_amount::bigint,p_on,p_memo,
      case when p_cover_ready then budget.ready_item(g.space_id) else null end);
  end if;
  v_receipt := jsonb_build_object('status','posted','requestId',p_request,'entryId',v_result->>'entryId',
    'spaceId',g.space_id,'kind',p_kind,'walletId',p_wallet,'itemId',p_item,'currency',p_currency,
    'amountMinor',p_amount,'on',p_on,'memo',p_memo,'coveredMinor',coalesce(v_result->>'covered','0'));
  insert into budget.mcp_receipts(user_id,client_id,request_id,ledger_request,payload,receipt)
    values(g.user_id,g.client_id,p_request,v_request,v_payload,v_receipt);
  return v_receipt;
end $$;

create function public.mcp_entry_status(p_token text,p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g budget.mcp_grants := budget.mcp_require_grant(p_token);
  v_receipt jsonb;
begin
  select receipt into v_receipt from budget.mcp_receipts
    where user_id=g.user_id and client_id=g.client_id and request_id=p_request and receipt->>'spaceId'=g.space_id::text;
  return coalesce(v_receipt,jsonb_build_object('status','not_found','requestId',p_request));
end $$;

revoke all on all functions in schema budget from public, anon, authenticated, service_role;
revoke all on function public.mcp_grant_client(text,uuid,text,text,text), public.mcp_connections(), public.mcp_revoke_client(text),
  public.mcp_exchange_code(text,text,text), public.mcp_context(text),
  public.mcp_record_entry(text,uuid,text,uuid,text,text,date,uuid,text,boolean), public.mcp_entry_status(text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_grant_client(text,uuid,text,text,text), public.mcp_connections(), public.mcp_revoke_client(text) to authenticated;
grant execute on function public.mcp_exchange_code(text,text,text), public.mcp_context(text),
  public.mcp_record_entry(text,uuid,text,uuid,text,text,date,uuid,text,boolean), public.mcp_entry_status(text,uuid) to anon;
